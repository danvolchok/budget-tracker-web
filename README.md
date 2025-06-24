# BudgetTracker Pro 💰

Professional-grade personal finance management with AI-powered merchant consolidation and Google Sheets integration.

## Features

- 🤖 **AI-Powered Merchant Cleaning**: GPT-4 integration for automatic merchant name consolidation
- 📊 **Google Sheets Integration**: Connect directly to your Google Sheets via Apps Script
- 📈 **Advanced Analytics**: Comprehensive spending insights with interactive charts
- 🏪 **Merchant Management**: 3-step merchant organization system
- 💼 **Budget Tracking**: Multi-period budget management (week, payweek, month, year)
- 📁 **Category Management**: Flexible categorization with group organization
- 🔍 **Smart Search**: Advanced transaction filtering and search
- ⚡ **Batch Processing**: High-performance bulk updates

## Quick Start

### 1. Deploy Google Apps Script

1. Open [Google Apps Script](https://script.google.com)
2. Create a new project
3. Copy the code from `apps-script-template.js` (see below)
4. Deploy as Web App:
   - Execute as: **"Me"**
   - Who has access: **"Anyone"**
5. Copy the Web App URL

### 2. Setup BudgetTracker

1. Open `index.html` in your browser
2. Paste your Apps Script Web App URL
3. Click "Connect & Browse Sheets"
4. Authenticate and select your budget spreadsheet
5. (Optional) Add OpenAI API key for AI merchant cleaning

### 3. Your Google Sheet Format

Your spreadsheet should have these columns:
- **Date**: Transaction date
- **Account**: Account name (e.g., "Checking", "Credit Card")
- **Category**: Expense category
- **Amount**: Transaction amount (negative for expenses)
- **Merchant**: Original merchant name
- **Description**: Transaction description
- **Merchant Group**: (Auto-populated by AI cleaning)

## Apps Script Template

Create a new Google Apps Script project and use this template:

```javascript
function doGet(e) {
  const action = e.parameter.action;
  
  // Handle CORS
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
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
      
      const sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
      const values = sheet.getRange(range).getValues();
      
      response = {
        success: true,
        values: values
      };
    }
  } catch (error) {
    response = {
      success: false,
      error: error.toString()
    };
  }
  
  output.setContent(JSON.stringify(response));
  
  // Set CORS headers
  return output.setHeaders({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const method = data.method;
    
    let response = {};
    
    if (method === 'BATCH_UPDATE') {
      response = handleBatchUpdate(data);
    } else if (method === 'UPDATE') {
      response = handleUpdate(data);
    } else {
      throw new Error('Unknown method: ' + method);
    }
    
    const output = ContentService.createTextOutput(JSON.stringify(response));
    output.setMimeType(ContentService.MimeType.JSON);
    
    return output.setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
  } catch (error) {
    const response = {
      success: false,
      error: error.toString()
    };
    
    const output = ContentService.createTextOutput(JSON.stringify(response));
    output.setMimeType(ContentService.MimeType.JSON);
    
    return output.setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
  }
}

function handleListSheets() {
  try {
    const files = DriveApp.searchFiles('mimeType="application/vnd.google-apps.spreadsheet"');
    const sheets = [];
    
    while (files.hasNext()) {
      const file = files.next();
      sheets.push({
        id: file.getId(),
        name: file.getName(),
        lastModified: file.getLastUpdated().toISOString()
      });
    }
    
    return {
      success: true,
      sheets: sheets.slice(0, 20) // Limit to 20 most recent
    };
  } catch (error) {
    return {
      success: false,
      error: error.toString()
    };
  }
}

function handleBatchUpdate(data) {
  try {
    const sheetId = data.sheetId;
    const updates = data.updates;
    
    if (!sheetId || !updates) {
      throw new Error('Sheet ID and updates are required');
    }
    
    const sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
    let updatedCount = 0;
    
    updates.forEach(update => {
      const range = update.range;
      const value = update.value;
      
      sheet.getRange(range).setValue(value);
      updatedCount++;
    });
    
    return {
      success: true,
      updatedCells: updatedCount,
      message: `Successfully updated ${updatedCount} cells`
    };
  } catch (error) {
    return {
      success: false,
      error: error.toString()
    };
  }
}

function handleUpdate(data) {
  try {
    const sheetId = data.sheetId;
    const range = data.range;
    const values = data.values;
    
    if (!sheetId || !range) {
      throw new Error('Sheet ID and range are required');
    }
    
    const sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
    
    if (values && values.length > 0) {
      if (values.length === 1 && values[0].length === 1) {
        // Single cell update
        sheet.getRange(range).setValue(values[0][0]);
      } else {
        // Multi-cell update
        sheet.getRange(range).setValues(values);
      }
    }
    
    return {
      success: true,
      updatedCells: 1,
      range: range
    };
  } catch (error) {
    return {
      success: false,
      error: error.toString()
    };
  }
}
```

## Architecture

```
budget-tracker-web/
├── index.html              # Main HTML file
├── config/
│   └── settings.js         # Configuration settings
├── js/
│   ├── main.js            # Main application class
│   ├── modules/           # Feature modules
│   │   ├── categories.js  # Category management
│   │   ├── charts.js      # Chart rendering
│   │   └── sheets-api.js  # Google Sheets API
│   ├── services/
│   │   └── merchant-cleaner.js # AI merchant cleaning
│   └── utils/             # Utility functions
├── styles/
│   └── main.css          # Application styles
└── README.md
```

## Configuration

### OpenAI Integration (Optional)

For AI-powered merchant cleaning, add your OpenAI API key:

1. Get an API key from [OpenAI](https://platform.openai.com/api-keys)
2. Enter it in the welcome screen
3. The system will automatically clean merchant names like:
   - "WAL-MART #3454" → "Wal-Mart"
   - "MCDONALD'S #12345" → "McDonald's"
   - "AMAZON.COM*4B2X3Y" → "Amazon"

### Google Sheets Format

Your budget spreadsheet should include these columns (case-insensitive):
- Date, Account, Category, Amount, Merchant, Description
- Optional: Merchant Group, Payweek, Recurring

## Features Overview

### 📊 Dashboard
- Real-time spending summaries
- Interactive charts and visualizations
- Period-based analysis (week/payweek/month/year)
- Quick stats and recent transactions

### 🏪 Merchant Management
- **Step 1**: Consolidate similar merchants into groups
- **Step 2**: Categorize merchant groups
- **Step 3**: Organize categories into logical groups
- AI-powered automatic merchant consolidation

### 💼 Budget Tracking
- Multi-period budget support
- Category-based budget allocation
- Real-time budget vs actual tracking
- Flexible budget periods

### 📁 Category Management
- Hierarchical category organization
- Spending analysis by category
- Custom category groups
- Automatic categorization suggestions

### 💰 Transaction Management
- Advanced search and filtering
- Bulk transaction operations
- Real-time editing capabilities
- Export functionality

## Performance

- **Batch Updates**: Processes 500+ merchant updates in seconds
- **Responsive UI**: Client-side caching for instant interactions
- **Smart Loading**: Progressive data loading with user feedback
- **Error Handling**: Comprehensive error recovery and user guidance

## Browser Compatibility

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - feel free to use this project for personal or commercial purposes.

## Support

For issues or questions:
1. Check the Apps Script deployment settings
2. Verify your Google Sheets format
3. Ensure CORS headers are properly set
4. Check browser console for detailed error messages

---

Built with ❤️ for better personal finance management