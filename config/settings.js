// Configuration settings for Budget Tracker
export const CONFIG = {
  // Google API Configuration
  GOOGLE: {
    DISCOVERY_DOC: 'https://sheets.googleapis.com/$discovery/rest?version=v4',
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',
    DEFAULT_CLIENT_ID: 'YOUR_CLIENT_ID_HERE',
    DEFAULT_API_KEY: 'YOUR_API_KEY_HERE'
  },

  // UI Configuration
  UI: {
    DEFAULT_LIMIT: 50,
    TOAST_DURATION: 5000,
    LOADING_TIMEOUT: 10000
  },

  // Category Groups
  CATEGORY_GROUPS: {
    'Living Expenses': ['Groceries', 'Utilities', 'Rent', 'Insurance', 'Healthcare'],
    'Lifestyle': ['Dining', 'Entertainment', 'Shopping', 'Travel', 'Hobbies'],
    'Financial': ['CC Payment', 'Savings', 'Investments', 'Bank Fees'],
    'Personal': ['Transportation', 'Education', 'Gifts', 'Other']
  },

  // Default Categories
  CATEGORIES: [
    'Transportation', 'Groceries', 'Dining', 'Entertainment', 
    'Utilities', 'Healthcare', 'Travel', 'Shopping', 
    'CC Payment', 'Other', 'Uncategorized'
  ],

  // LocalStorage Keys
  STORAGE_KEYS: {
    USE_APPS_SCRIPT: 'budgetTracker_useAppsScript',
    APPS_SCRIPT_URL: 'budgetTracker_appsScriptUrl',
    CLIENT_ID: 'budgetTracker_clientId',
    API_KEY: 'budgetTracker_apiKey',
    SHEET_ID: 'budgetTracker_sheetId',
    MERCHANT_GROUPS: 'budgetTracker_merchantGroups',
    CATEGORIES: 'budgetTracker_categories',
    CATEGORY_GROUPS: 'budgetTracker_categoryGroups'
  },

  // Merchant Patterns for Auto-Categorization
  MERCHANT_PATTERNS: {
    'Groceries': ['walmart', 'target', 'kroger', 'safeway', 'whole foods', 'trader joe', 'costco', 'sam\'s club'],
    'Transportation': ['shell', 'exxon', 'chevron', 'bp', 'uber', 'lyft', 'taxi'],
    'Dining': ['mcdonald', 'starbucks', 'subway', 'pizza', 'restaurant', 'cafe', 'diner'],
    'Entertainment': ['netflix', 'spotify', 'movie', 'theater', 'game', 'amazon prime'],
    'Utilities': ['electric', 'gas company', 'water', 'internet', 'phone', 'cable']
  }
};