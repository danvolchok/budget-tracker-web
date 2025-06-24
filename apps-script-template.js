/**
 * Google Apps Script Template for BudgetTracker Pro
 * 
 * SETUP INSTRUCTIONS:
 * 1. Create a new Google Apps Script project at script.google.com
 * 2. Replace the default Code.gs content with this entire file
 * 3. Save the project
 * 4. Deploy as Web App:
 *    - Click "Deploy" > "New deployment"
 *    - Type: "Web app"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"
 * 5. Copy the Web App URL and use it in BudgetTracker Pro
 * 
 * FEATURES:
 * - Handles data loading from Google Sheets
 * - Supports batch updates for performance
 * - Lists available spreadsheets
 * - Includes proper CORS headers
 * - Error handling and logging
 */

/**
 * Handle GET requests - used for data loading and sheet listing
 */
function doGet(e) {
  console.log('GET request received with parameters:', e.parameter);
  
  const action = e.parameter.action;
  let response = {};
  
  try {
    if (action === 'listSheets') {
      response = handleListSheets();
    } else {
      // Default data loading
      const sheetId = e.parameter.sheetId;
      const range = e.parameter.range || 'Sheet1!A:Z';
      
      if (!sheetId) {
        throw new Error('Sheet ID is required');
      }
      
      console.log(`Loading data from sheet: ${sheetId}, range: ${range}`);
      
      const spreadsheet = SpreadsheetApp.openById(sheetId);
      const sheet = spreadsheet.getActiveSheet();
      const values = sheet.getRange(range).getValues();
      
      console.log(`Loaded ${values.length} rows of data`);
      
      response = {
        success: true,
        values: values,
        sheetName: sheet.getName(),
        lastUpdated: new Date().toISOString()
      };
    }
  } catch (error) {
    console.error('Error in doGet:', error);
    response = {
      success: false,
      error: error.toString(),
      timestamp: new Date().toISOString()
    };
  }
  
  return createCORSResponse(response);
}

/**
 * Handle POST requests - used for updates and batch operations
 */
function doPost(e) {
  console.log('POST request received');
  
  try {
    const data = JSON.parse(e.postData.contents);
    console.log('POST data:', data);
    
    const method = data.method;
    let response = {};
    
    if (method === 'BATCH_UPDATE') {
      response = handleBatchUpdate(data);
    } else if (method === 'UPDATE') {
      response = handleUpdate(data);
    } else {
      throw new Error('Unknown method: ' + method);
    }
    
    return createCORSResponse(response);
  } catch (error) {
    console.error('Error in doPost:', error);
    const response = {
      success: false,
      error: error.toString(),
      timestamp: new Date().toISOString()
    };
    
    return createCORSResponse(response);
  }
}

/**
 * List available Google Sheets in user's Drive
 */
function handleListSheets() {
  try {
    console.log('Listing user spreadsheets...');
    
    // Search for spreadsheet files in Drive
    const files = DriveApp.searchFiles(
      'mimeType="application/vnd.google-apps.spreadsheet" and trashed=false'
    );
    
    const sheets = [];
    let count = 0;
    
    // Limit to 20 most recent files for performance
    while (files.hasNext() && count < 20) {
      const file = files.next();
      sheets.push({
        id: file.getId(),
        name: file.getName(),
        lastModified: file.getLastUpdated().toISOString(),
        url: file.getUrl()
      });
      count++;
    }
    
    // Sort by last modified date (most recent first)
    sheets.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    
    console.log(`Found ${sheets.length} spreadsheets`);
    
    return {
      success: true,
      sheets: sheets,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error listing sheets:', error);
    return {
      success: false,
      error: error.toString(),
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Handle batch updates for performance - updates multiple cells at once
 */
function handleBatchUpdate(data) {
  try {
    const sheetId = data.sheetId;
    const updates = data.updates;
    
    if (!sheetId || !updates || !Array.isArray(updates)) {
      throw new Error('Sheet ID and updates array are required');
    }
    
    console.log(`Starting batch update: ${updates.length} updates for sheet ${sheetId}`);
    
    const spreadsheet = SpreadsheetApp.openById(sheetId);
    const sheet = spreadsheet.getActiveSheet();
    
    let updatedCount = 0;
    const startTime = new Date();
    
    // Process updates in batches to avoid timeout
    const batchSize = 100;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      batch.forEach(update => {
        const range = update.range;
        const value = update.value;
        
        if (range && value !== undefined) {
          sheet.getRange(range).setValue(value);
          updatedCount++;
        }
      });
      
      // Brief pause between batches to prevent quota issues
      if (i + batchSize < updates.length) {
        Utilities.sleep(100);
      }
    }
    
    const endTime = new Date();
    const duration = endTime - startTime;
    
    console.log(`Batch update completed: ${updatedCount} cells updated in ${duration}ms`);
    
    return {
      success: true,
      updatedCells: updatedCount,
      duration: duration,
      message: `Successfully updated ${updatedCount} cells in ${duration}ms`,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error in batch update:', error);
    return {
      success: false,
      error: error.toString(),
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Handle single cell or range updates
 */
function handleUpdate(data) {
  try {
    const sheetId = data.sheetId;
    const range = data.range;
    const values = data.values;
    
    if (!sheetId || !range) {
      throw new Error('Sheet ID and range are required');
    }
    
    console.log(`Updating range: ${range} in sheet: ${sheetId}`);
    
    const spreadsheet = SpreadsheetApp.openById(sheetId);
    const sheet = spreadsheet.getActiveSheet();
    
    if (values && values.length > 0) {
      if (values.length === 1 && values[0].length === 1) {
        // Single cell update
        sheet.getRange(range).setValue(values[0][0]);
        console.log(`Updated single cell ${range} with value: ${values[0][0]}`);
      } else {
        // Multi-cell update
        sheet.getRange(range).setValues(values);
        console.log(`Updated range ${range} with ${values.length} rows`);
      }
    } else {
      // Clear the range if no values provided
      sheet.getRange(range).clear();
      console.log(`Cleared range: ${range}`);
    }
    
    return {
      success: true,
      updatedCells: values ? (values.length * (values[0] ? values[0].length : 1)) : 1,
      range: range,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error in update:', error);
    return {
      success: false,
      error: error.toString(),
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Create response with proper CORS headers for web app access
 */
function createCORSResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  
  // Set comprehensive CORS headers
  return output.setHeaders({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400', // 24 hours
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
}

/**
 * Handle OPTIONS requests for CORS preflight
 */
function doOptions(e) {
  return createCORSResponse({
    success: true,
    message: 'CORS preflight successful'
  });
}

/**
 * Utility function to get spreadsheet metadata
 */
function getSpreadsheetInfo(sheetId) {
  try {
    const spreadsheet = SpreadsheetApp.openById(sheetId);
    const sheets = spreadsheet.getSheets();
    
    const sheetInfo = sheets.map(sheet => ({
      name: sheet.getName(),
      index: sheet.getIndex(),
      rows: sheet.getLastRow(),
      columns: sheet.getLastColumn()
    }));
    
    return {
      success: true,
      spreadsheetName: spreadsheet.getName(),
      sheets: sheetInfo,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * Test function to verify the Apps Script is working
 */
function testConnection() {
  console.log('Apps Script connection test successful!');
  return {
    success: true,
    message: 'Apps Script is working correctly',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  };
}