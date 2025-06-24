// Google Drive Picker for selecting Google Sheets
import { CONFIG } from '../../config/settings.js';
import { Storage } from '../utils/storage.js';
import { UI } from '../utils/ui.js';

export class DrivePicker {
  constructor(sheetsAPI) {
    this.sheetsAPI = sheetsAPI;
    this.pickerApiLoaded = false;
    this.accessToken = null;
  }

  // Initialize the Google Picker API
  async init() {
    try {
      // Wait for Picker API to be loaded
      if (typeof google !== 'undefined' && google.picker) {
        this.pickerApiLoaded = true;
      } else {
        // Retry after a short delay
        setTimeout(() => this.init(), 500);
      }
    } catch (error) {
      console.error('Error initializing Picker API:', error);
    }
  }

  // Get access token for Picker
  async getAccessToken() {
    const credentials = Storage.getCredentials();
    
    if (credentials.useAppsScript) {
      // For Apps Script, we don't need an access token
      return null;
    }

    // Check if we have a valid API key
    if (credentials.apiKey === CONFIG.GOOGLE.DEFAULT_API_KEY) {
      throw new Error('Please configure your Google API credentials first');
    }

    // Request access token using the existing token client
    return new Promise((resolve, reject) => {
      if (!this.sheetsAPI.tokenClient) {
        reject(new Error('Google authentication not initialized'));
        return;
      }

      // Set up callback to get the token
      const originalCallback = this.sheetsAPI.tokenClient.callback;
      this.sheetsAPI.tokenClient.callback = (response) => {
        if (response.access_token) {
          this.accessToken = response.access_token;
          resolve(response.access_token);
        } else {
          reject(new Error('Failed to get access token'));
        }
        // Restore original callback
        this.sheetsAPI.tokenClient.callback = originalCallback;
      };

      // Request access token
      this.sheetsAPI.tokenClient.requestAccessToken({
        prompt: 'consent'
      });
    });
  }

  // Create and show the Google Picker
  async showPicker() {
    try {
      if (!this.pickerApiLoaded) {
        await this.init();
        if (!this.pickerApiLoaded) {
          throw new Error('Google Picker API not loaded');
        }
      }

      const credentials = Storage.getCredentials();

      // For Apps Script mode, show a different picker or error
      if (credentials.useAppsScript) {
        UI.showToast('Browse feature requires Google API mode. Please configure your API credentials.', 'warning');
        return;
      }

      // Get access token
      UI.showLoading('Authenticating with Google...');
      
      try {
        await this.getAccessToken();
      } catch (error) {
        UI.hideLoading();
        throw error;
      }

      UI.hideLoading();

      // Create and show the picker
      const picker = new google.picker.PickerBuilder()
        .addView(new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(false))
        .setOAuthToken(this.accessToken)
        .setDeveloperKey(credentials.apiKey)
        .setCallback(this.onPickerCallback.bind(this))
        .setTitle('Select a Google Sheets document')
        .setSize(1050, 650)
        .build();

      picker.setVisible(true);

    } catch (error) {
      UI.hideLoading();
      UI.handleError(error, 'Failed to open sheet browser');
    }
  }

  // Handle picker selection
  onPickerCallback(data) {
    if (data.action === google.picker.Action.PICKED) {
      const doc = data.docs[0];
      const sheetId = doc.id;
      const sheetName = doc.name;
      const sheetUrl = doc.url;


      // Update the input field with the selected sheet ID
      const sheetInput = document.getElementById('sheet-id-input');
      if (sheetInput) {
        sheetInput.value = sheetId;
      }

      // Show success message
      UI.showToast(`Selected: ${sheetName}`, 'success');

      // Store the sheet info for future reference
      this.storeRecentSheet({
        id: sheetId,
        name: sheetName,
        url: sheetUrl,
        lastUsed: new Date().toISOString()
      });

      // Automatically connect to the selected sheet
      if (window.budgetApp) {
        setTimeout(() => {
          window.budgetApp.connectToSheet();
        }, 500);
      }

    }
  }

  // Store recent sheet for quick access
  storeRecentSheet(sheetInfo) {
    const recentSheets = Storage.get('budgetTracker_recentSheets', []);
    
    // Remove if already exists
    const filtered = recentSheets.filter(sheet => sheet.id !== sheetInfo.id);
    
    // Add to beginning
    filtered.unshift(sheetInfo);
    
    // Keep only last 5
    const trimmed = filtered.slice(0, 5);
    
    Storage.set('budgetTracker_recentSheets', trimmed);
  }

  // Get recent sheets
  getRecentSheets() {
    return Storage.get('budgetTracker_recentSheets', []);
  }

  // Create recent sheets dropdown (future enhancement)
  createRecentSheetsDropdown() {
    const recentSheets = this.getRecentSheets();
    
    if (recentSheets.length === 0) {
      return null;
    }

    const dropdown = document.createElement('select');
    dropdown.className = 'input-standard';
    dropdown.style.marginRight = '0.5rem';
    
    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Recent Sheets...';
    dropdown.appendChild(defaultOption);

    // Add recent sheets
    recentSheets.forEach(sheet => {
      const option = document.createElement('option');
      option.value = sheet.id;
      option.textContent = `${sheet.name} (${new Date(sheet.lastUsed).toLocaleDateString()})`;
      dropdown.appendChild(option);
    });

    // Handle selection
    dropdown.addEventListener('change', (e) => {
      if (e.target.value) {
        const sheetInput = document.getElementById('sheet-id-input');
        if (sheetInput) {
          sheetInput.value = e.target.value;
        }
      }
    });

    return dropdown;
  }
}