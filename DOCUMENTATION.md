# Budget Tracker Web App - Complete Documentation

## Overview
A personal finance management application that connects to Google Sheets to analyze transaction data, automatically clean merchant names, categorize expenses, and provide budget insights.

## Core Goals
1. **Data Source**: Google Sheets stores transactions imported from email
2. **Merchant Cleaning**: Auto-consolidate similar merchant names (e.g., "Wal-Mart #3454" → "Wal-Mart")
3. **Categorization**: Organize merchants into spending categories
4. **Budget Tracking**: Set budgets and track spending against them
5. **Financial Insights**: Net worth, income vs spending per time period

## File Structure

### Core Application Files
- `index.html` - Main HTML structure and UI
- `js/main.js` - Main application logic (3,200+ lines)
- `styles/main.css` - CSS styling (201 lines)
- `config/settings.js` - Configuration constants

### Utility Modules
- `js/utils/storage.js` - LocalStorage management
- `js/utils/ui.js` - UI helper functions (toasts, etc.)
- `js/utils/url-parser.js` - URL parsing utilities
- `js/utils/validators.js` - Data validation functions
- `js/utils/formatters.js` - Data formatting utilities

### Feature Modules
- `js/modules/sheets-api.js` - Google Sheets API integration
- `js/modules/categories.js` - Category management
- `js/modules/charts.js` - Chart/visualization management
- `js/modules/drive-picker.js` - Google Drive sheet picker

## Data Structure

### Google Sheets Columns
Based on the codebase analysis:
- **Account** - Account name (PC 7117, RBC 6273, etc.)
- **Debit** - Transaction amount
- **Merchant** - Raw merchant name from transaction
- **Date2** - Secondary date field
- **Date** - Primary transaction date
- **ID** - Unique transaction identifier
- **Payweek** - Pay period identifier
- **Category** - Spending category
- **Recurring** - Recurring transaction flag
- **Merchant Group** - Cleaned/consolidated merchant name
- **Is Grouped** - Boolean flag for grouping status

## Main Application Class (BudgetTrackerApp)

### Core Properties
```javascript
this.sheetsAPI = new SheetsAPI();
this.categoryManager = new CategoryManager();
this.chartManager = new ChartManager();
this.drivePicker = new DrivePicker();
this.rowsData = []; // Main transaction data
this.currentView = 'dashboard'; // Active view
this.currentPeriod = 'month'; // Time period filter
this.budgets = {}; // Budget data
this.merchantEditingCache = {}; // Merchant editing cache
this.columnIndices = {}; // Column position mapping
```

### Initialization Functions

#### `constructor()`
- Initializes core modules
- Sets up application state variables
- Defines column indices for data mapping

#### `init()`
- Loads stored credentials
- Initializes Google APIs
- Auto-loads data if credentials exist
- Sets up event listeners

#### `onAPIsReady()`
- Called when Google APIs are loaded
- Initializes Sheets API
- Auto-loads data based on credential type

### Data Loading Functions

#### `loadData(sheetId)`
- Loads transaction data from Google Sheets via API
- Processes and validates data
- Updates all views with new data
- Handles errors with user feedback

#### `loadDataFromAppsScript()`
- Loads data through Google Apps Script
- Alternative to direct API access
- Same processing as `loadData()`

#### `processSheetData(dataRows)`
- Maps sheet columns to application indices
- Validates required columns exist
- Sets up column position mapping

### Authentication Functions

#### `openAppsScriptAuth()`
- Opens Apps Script authentication popup
- Handles sheet selection from popup
- Stores credentials and loads data

#### `connectWithSheetId()`
- Direct sheet ID connection
- Validates sheet ID format
- Stores credentials and loads data

#### `disconnect()`
- Clears stored credentials
- Resets application state
- Returns to welcome screen

### View Management Functions

#### `showView(viewName)`
- Switches between main application views
- Updates navigation active states
- Renders appropriate view content

#### `updateCurrentView()`
- Refreshes current view with latest data
- Called after data changes

### Dashboard Functions

#### `renderDashboardView()`
- Renders summary cards with totals
- Updates charts with transaction data
- Shows recent transactions table
- Updates quick stats

#### `updateSummaryCards(transactions)`
- Calculates and displays total spending
- Shows transaction count
- Calculates average transaction amount

#### `renderRecentTable(transactions)`
- Shows recent transactions in table format
- Applies current period filter
- Displays merchant group or fallback to merchant

#### `updateQuickStats(transactions)`
- Calculates spending by time period
- Shows week, month, year totals

### Transaction Management Functions

#### `renderTransactionsView()`
- Shows all transactions with filters
- Applies search and period filters
- Provides sorting and pagination

#### `getFilteredRows()`
- Filters transactions by selected period
- Handles payweek, week, month, year periods
- Returns filtered transaction array

#### `searchTransactions(searchTerm)`
- Filters transactions by search term
- Searches across multiple fields (merchant, account, category)
- Updates transaction view

#### `clearTransactionSearch()`
- Clears search term and filters
- Refreshes transaction view

### Period Management Functions

#### `setPeriod(period)`
- Sets active time period filter
- Updates UI to reflect new period
- Refreshes current view

#### `getPayweekRange(date)`
- Calculates payweek date range
- Returns start and end dates for payweek

#### `isCurrentPayweek(transactionDate)`
- Checks if transaction is in current payweek
- Returns boolean result

### Merchant Management Functions

#### `setMerchantStep(step)`
- Switches between merchant management steps
- Updates step navigation UI
- Renders appropriate step content

#### `renderMerchantStepContent()`
- Renders content for current merchant step
- Handles 3-step merchant organization process

#### `renderMerchantGroupStep(container)`
- Step 1: Consolidate similar merchants
- Shows merchant list with grouping options
- Allows bulk merchant renaming

#### `renderCategoryStep(container, transactions)`
- Step 2: Categorize merchant groups
- Shows merchant groups with category assignment
- Handles category changes

#### `renderCategoryGroupsStep(container, transactions)`
- Step 3: Organize categories by type
- Shows category hierarchy management

#### Merchant Editing Cache Functions
- `enableMerchantEditingCache()` - Enables responsive UI cache
- `disableMerchantEditingCache()` - Disables cache and saves changes
- `saveCachedMerchantChanges()` - Saves all cached changes to sheets
- `revertCachedChanges()` - Reverts unsaved changes

### Category Management Functions

#### `renderCategoriesView()`
- Shows category overview with spending data
- Groups by category type
- Shows spending amounts per category

### Budget Management Functions

#### `renderBudgetsView()`
- Shows budget setting interface
- Allows budget amount modification
- Displays budget vs actual spending

#### `saveBudgets()`
- Saves budget changes to storage/sheets
- Updates budget displays

#### `onBudgetPeriodChange(period)`
- Changes budget period basis
- Recalculates budget displays

### Utility Functions

#### `getColumnValue(row, columnType)`
- Gets value from row by column type
- Uses columnIndices mapping
- Returns null if column not found

#### `updateAllViews(transactions)`
- Updates all UI components with new data
- Refreshes charts, tables, summaries
- Marks data as changed

#### `showSheetChanger()`
- Shows interface to change connected sheet
- Allows switching between sheets

#### `clearAllMerchantGroups()`
- Clears all merchant group values
- Bulk update to reset groupings

## SheetsAPI Class Functions

### Authentication
- `init()` - Initialize Google APIs
- `onAPIsReady()` - Handle API ready state
- `initializeGapiClient()` - Setup GAPI client
- `initTokenClient()` - Setup token client

### Data Operations
- `loadData(sheetId)` - Load sheet data
- `updateCell(sheetId, range, value)` - Update single cell
- `updateRange(sheetId, range, values)` - Update cell range
- `ensureColumn(sheetId, columnName)` - Ensure column exists

### Apps Script Integration
- `appsScriptRequest(method, params)` - Make Apps Script requests
- Handles authentication and data flow through Apps Script

## CategoryManager Class Functions

### Category Operations
- `updateCategorySummaryCards(transactions)` - Update category summaries
- `findCategoryGroup(category)` - Find category group for category
- `onCategoryGroupChange()` - Handle category group filter changes

## ChartManager Class Functions

### Chart Operations
- `updateAllCharts(transactions)` - Update all dashboard charts
- Handles spending visualizations
- Period-based chart updates

## UI Helper Functions

### Storage Class
- `get(key, defaultValue)` - Get from localStorage
- `set(key, value)` - Save to localStorage
- `getCredentials()` - Get stored credentials
- `saveCredentials(credentials)` - Save credentials

### UI Class
- `showToast(message, type)` - Show notification toasts
- `handleError(error, context)` - Handle and display errors

### Validators Class
- `sheetId(id)` - Validate Google Sheet ID format
- Other validation functions

### Formatters Class
- `currency(amount)` - Format currency values
- `date(date)` - Format date values
- Other formatting utilities

## Current Issues Identified

1. **Merchant Group Clearing**: Function exists but may not be working properly
2. **Search Functionality**: Complex row mapping logic causing inconsistent results
3. **Data Synchronization**: Merchant groups showing cached/incorrect values
4. **GPT-4 Integration**: Missing automatic merchant cleaning
5. **Budget Calculations**: May not be properly aligned with actual spending
6. **Net Worth Calculation**: Not implemented for investment/income tracking

## Missing Features (Based on Goals)

1. **Automatic Merchant Cleaning**: No GPT-4 or regex-based merchant consolidation
2. **Investment Tracking**: No net worth or investment receipt handling
3. **Income Tracking**: No direct deposit/paycheck analysis
4. **Spending Trend Analysis**: Limited period-over-period comparison
5. **Budget Alerts**: No notifications when approaching budget limits

## Recommendations

1. **Simplify Merchant Management**: Remove complex caching, use direct sheet updates
2. **Implement GPT-4 Cleaning**: Add automatic merchant name consolidation
3. **Fix Search**: Simplify transaction search to use display values directly
4. **Add Net Worth**: Implement investment and income tracking
5. **Improve Budget Tracking**: Better alignment between budgets and actual spending
6. **Add Missing Categories**: Ensure all merchants can be categorized properly