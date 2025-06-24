// Google Sheets API integration
import { CONFIG } from '../../config/settings.js';
import { Storage } from '../utils/storage.js';
import { UI } from '../utils/ui.js';
import { Validators } from '../utils/validators.js';

export class SheetsAPI {
  constructor() {
    this.gapiLoaded = false;
    this.gisLoaded = false;
    this.tokenClient = null;
    this.credentials = Storage.getCredentials();
  }

  // Initialize Google APIs
  async init() {
    if (this.credentials.useAppsScript) {
      this.gapiLoaded = true;
      this.gisLoaded = true;
      return true;
    }

    // GAPI will be initialized from global functions
    return true;
  }

  // Called when both GAPI and GIS are loaded
  async onAPIsReady() {
    if (this.credentials.useAppsScript) {
      return;
    }

    try {
      // Only initialize if we have valid credentials
      if (this.credentials.apiKey === CONFIG.GOOGLE.DEFAULT_API_KEY) {
        return;
      }

      await this.initializeGapiClient();
      this.initTokenClient();
      this.gapiLoaded = true;
      this.gisLoaded = true;
    } catch (error) {
      console.error('Error initializing Google APIs:', error);
    }
  }

  async initializeGapiClient() {
    try {
      await gapi.client.init({
        apiKey: this.credentials.apiKey,
        discoveryDocs: [CONFIG.GOOGLE.DISCOVERY_DOC]
      });
    } catch (error) {
      console.error('Error initializing GAPI client:', error);
      throw error;
    }
  }

  initTokenClient() {
    if (this.credentials.useAppsScript) return;

    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: this.credentials.clientId,
      scope: CONFIG.GOOGLE.SCOPES,
      callback: () => {}
    });
    this.gisLoaded = true;
    this.checkAPIsReady();
  }

  checkAPIsReady() {
    if (this.gapiLoaded && this.gisLoaded) {
      return true;
    }
    return false;
  }

  // Apps Script Integration - Multiple request strategies
  async appsScriptRequest(method, data) {
    // For batch updates, use POST to avoid URL length limits
    if (method === 'BATCH_UPDATE') {
      return this.appsScriptBatchRequest(data);
    }
    
    const strategies = [
      // Strategy 1: GET with parameters (most compatible)
      async () => {
        const params = new URLSearchParams({
          method: method,
          ...data
        });
        const url = `${this.credentials.appsScriptUrl}?${params.toString()}`;
        
        return await fetch(url, {
          method: 'GET',
          mode: 'cors',
          headers: { 'Accept': 'application/json' }
        });
      },
      
      // Strategy 2: POST with JSON (if CORS is configured)
      async () => {
        return await fetch(this.credentials.appsScriptUrl, {
          method: 'POST',
          mode: 'cors',
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ method, ...data })
        });
      },
      
      // Strategy 3: JSONP-style callback (fallback)
      async () => {
        const params = new URLSearchParams({
          method: method,
          callback: 'handleResponse',
          ...data
        });
        const url = `${this.credentials.appsScriptUrl}?${params.toString()}`;
        
        return await fetch(url, {
          method: 'GET',
          mode: 'no-cors'
        });
      }
    ];

    let lastError = null;
    
    for (let i = 0; i < strategies.length; i++) {
      try {
        const response = await strategies[i]();
        
        if (!response.ok && response.status !== 0) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        // For no-cors requests, we can't read the response
        if (response.type === 'opaque') {
          return { success: true, note: 'Request sent successfully (no-cors mode)' };
        }
        
        const result = await response.json();
        return result;
        
      } catch (error) {
        lastError = error;
        continue;
      }
    }

    // All strategies failed
    console.error('All Apps Script connection strategies failed:', lastError);
    
    // Provide helpful error message
    if (lastError.message.includes('Failed to fetch') || lastError.message.includes('CORS')) {
      throw new Error(`CORS Configuration Required: Please ensure your Google Apps Script is:

1. Deployed as a Web App
2. Execute as: "Me" 
3. Who has access: "Anyone"
4. Includes CORS headers in the response

Example Apps Script code:
function doGet(e) {
  const response = { /* your data */ };
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
}`);
    }
    
    throw lastError;
  }

  // Special handling for batch updates
  async appsScriptBatchRequest(data) {
    console.log('Sending batch request with', data.updates?.length, 'updates');
    
    try {
      // Use POST only for batch updates to avoid URL length limits
      const response = await fetch(this.credentials.appsScriptUrl, {
        method: 'POST',
        mode: 'cors',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ 
          method: 'BATCH_UPDATE',
          sheetId: data.sheetId,
          updates: data.updates
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      return result;
      
    } catch (error) {
      console.error('Batch request failed:', error);
      throw new Error(`Apps Script batch request failed: ${error.message}. Please ensure your Apps Script supports BATCH_UPDATE method via POST.`);
    }
  }

  // Connect to Google Sheets
  async connect(sheetId) {
    try {
      UI.showLoading('Connecting to Google Sheets...');
      
      const validatedSheetId = Validators.sheetId(sheetId);
      Storage.set(CONFIG.STORAGE_KEYS.SHEET_ID, validatedSheetId);
      
      if (this.credentials.useAppsScript) {
        const response = await this.appsScriptRequest('GET', {
          sheetId: validatedSheetId,
          range: 'Sheet1!A1:B2'
        });
        
        if (response.error) {
          throw new Error(`Apps Script connection failed: ${response.error}`);
        }
      } else {
        // Check if APIs are properly initialized
        if (!window.gapi || !window.gapi.client || !this.tokenClient) {
          throw new Error('Google APIs not initialized. Please configure your API credentials first.');
        }

        this.tokenClient.requestAccessToken({ prompt: 'consent' });
        
        // Test connection with a simple read
        const response = await gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: validatedSheetId,
          range: 'Sheet1!A1:B2'
        });
        
        if (!response.result) {
          throw new Error('Failed to connect to Google Sheets');
        }
      }

      UI.hideLoading();
      UI.showToast('Successfully connected to Google Sheets!', 'success');
      return true;
    } catch (error) {
      UI.hideLoading();
      UI.handleError(error, 'Connection failed');
      return false;
    }
  }

  // Load data from sheets
  async loadData(sheetId) {
    try {
      UI.showLoading('Fetching data from Google Sheets...');
      
      const validatedSheetId = Validators.sheetId(sheetId);
      let dataRows = [];

      if (this.credentials.useAppsScript) {
        const response = await this.appsScriptRequest('GET', {
          sheetId: validatedSheetId,
          range: 'Sheet1!A:Z'
        });
        
        if (response.error) {
          throw new Error(`Apps Script error: ${response.error}`);
        }
        
        dataRows = response.values || [];
      } else {
        // Check if gapi client is initialized
        if (!window.gapi || !window.gapi.client || !window.gapi.client.sheets) {
          throw new Error('Google Sheets API not initialized. Please check your API credentials.');
        }

        const response = await gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: validatedSheetId,
          range: 'Sheet1!A:Z'
        });
        
        dataRows = response.result.values || [];
      }

      if (dataRows.length === 0) {
        throw new Error('No data found in the spreadsheet');
      }

      UI.hideLoading();
      return dataRows;
    } catch (error) {
      UI.hideLoading();
      throw error;
    }
  }

  // Update cell in sheets
  async updateCell(sheetId, range, value) {
    try {
      const validatedSheetId = Validators.sheetId(sheetId);

      // Auto-detect Apps Script usage if URL is present
      const usingAppsScript = this.credentials.useAppsScript || 
                            (this.credentials.appsScriptUrl && this.credentials.appsScriptUrl.includes('script.google.com'));

      if (usingAppsScript) {
        console.log(`Apps Script UPDATE request: ${range} = "${value}"`); // Debug
        
        const response = await this.appsScriptRequest('UPDATE', {
          sheetId: validatedSheetId,
          range: range,
          values: [[value]]
        });
        
        console.log('Apps Script UPDATE response:', response); // Debug
        
        if (response.error) {
          throw new Error(`Update failed: ${response.error}`);
        }
        
        // Check if response indicates success
        if (!response.success && !response.updatedCells && !response.updatedRows) {
          console.warn('Apps Script UPDATE response lacks success confirmation:', response);
          // Don't throw error, but log warning - some Apps Scripts may not return explicit success
        }
        
        return response;
      } else {
        const response = await gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: validatedSheetId,
          range: range,
          valueInputOption: 'RAW',
          resource: { values: [[value]] }
        });
        
        return response.result;
      }
    } catch (error) {
      console.error('Error updating cell:', error);
      throw error;
    }
  }

  // Batch update multiple cells at once
  async batchUpdateCells(sheetId, updates) {
    try {
      const validatedSheetId = Validators.sheetId(sheetId);
      console.log(`Apps Script BATCH_UPDATE request: ${updates.length} updates`); // Debug

      // Auto-detect Apps Script usage if URL is present
      const usingAppsScript = this.credentials.useAppsScript || 
                            (this.credentials.appsScriptUrl && this.credentials.appsScriptUrl.includes('script.google.com'));

      if (usingAppsScript) {
        const response = await this.appsScriptRequest('BATCH_UPDATE', {
          sheetId: validatedSheetId,
          updates: updates // Array of {range, value} objects
        });
        
        console.log('Apps Script BATCH_UPDATE response:', response); // Debug
        
        if (response.error) {
          throw new Error(`Batch update failed: ${response.error}`);
        }
        
        return response;
      } else {
        // For Google Sheets API, use batchUpdate
        const requests = updates.map(update => ({
          updateCells: {
            range: {
              sheetId: 0, // Assuming first sheet
              startRowIndex: parseInt(update.range.match(/\d+/)[0]) - 1,
              endRowIndex: parseInt(update.range.match(/\d+/)[0]),
              startColumnIndex: update.range.charCodeAt(0) - 65,
              endColumnIndex: update.range.charCodeAt(0) - 64
            },
            rows: [{
              values: [{
                userEnteredValue: { stringValue: update.value }
              }]
            }],
            fields: 'userEnteredValue'
          }
        }));

        const response = await gapi.client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: validatedSheetId,
          resource: { requests }
        });
        
        return response.result;
      }
    } catch (error) {
      console.error('Error in batch update:', error);
      throw error;
    }
  }

  async updateRange(sheetId, range, values) {
    try {
      const validatedSheetId = Validators.sheetId(sheetId);

      if (this.credentials.useAppsScript) {
        const response = await this.appsScriptRequest('UPDATE', {
          sheetId: validatedSheetId,
          range: range,
          values: values
        });
        
        if (response.error) {
          throw new Error(`Update failed: ${response.error}`);
        }
        
        return response;
      } else {
        const response = await gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: validatedSheetId,
          range: range,
          valueInputOption: 'RAW',
          resource: { values: values }
        });
        
        return response.result;
      }
    } catch (error) {
      console.error('Error updating range:', error);
      throw error;
    }
  }

  // Ensure column exists
  async ensureColumn(sheetId, columnName) {
    try {
      const data = await this.loadData(sheetId);
      const headers = data[0] || [];
      
      let columnIndex = headers.findIndex(h => 
        h && h.toLowerCase().includes(columnName.toLowerCase())
      );

      if (columnIndex === -1) {
        // Add new column
        columnIndex = headers.length;
        const columnLetter = this.numberToLetter(columnIndex + 1);
        
        await this.updateCell(sheetId, `${columnLetter}1`, columnName);
      }

      return columnIndex;
    } catch (error) {
      console.error('Error ensuring column exists:', error);
      throw error;
    }
  }

  // Utility: Convert number to Excel column letter
  numberToLetter(num) {
    let result = '';
    while (num > 0) {
      num--;
      result = String.fromCharCode(65 + (num % 26)) + result;
      num = Math.floor(num / 26);
    }
    return result;
  }

  // Update credentials
  updateCredentials(newCredentials) {
    this.credentials = { ...this.credentials, ...newCredentials };
    Storage.saveCredentials(this.credentials);
  }
}