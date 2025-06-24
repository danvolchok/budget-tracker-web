// URL parsing utilities for Google Sheets and Apps Script URLs

export class URLParser {
  // Extract Google Sheets ID from various URL formats
  static extractSheetId(input) {
    if (!input || typeof input !== 'string') {
      return null;
    }

    const trimmed = input.trim();

    // If it's already just a Sheet ID (no slashes), return it
    if (!trimmed.includes('/') && trimmed.length > 20) {
      return trimmed;
    }

    // Pattern for Google Sheets URLs
    const patterns = [
      // Standard share URL: https://docs.google.com/spreadsheets/d/SHEET_ID/edit...
      /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
      // Edit URL: https://docs.google.com/spreadsheets/d/SHEET_ID/edit
      /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
      // Direct URL with Sheet ID
      /\/d\/([a-zA-Z0-9-_]+)/
    ];

    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  // Validate Apps Script URL
  static validateAppsScriptUrl(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }

    const trimmed = url.trim();
    
    // Check for Apps Script URL patterns
    const patterns = [
      /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9-_]+\/exec/,
      /^https:\/\/script\.googleusercontent\.com\/macros\/echo/
    ];

    return patterns.some(pattern => pattern.test(trimmed));
  }

  // Extract Apps Script ID from URL (for future use)
  static extractAppsScriptId(url) {
    if (!url || typeof url !== 'string') {
      return null;
    }

    const match = url.match(/\/macros\/s\/([a-zA-Z0-9-_]+)\//);
    return match ? match[1] : null;
  }

  // Clean and validate URL input
  static cleanUrl(input) {
    if (!input || typeof input !== 'string') {
      return '';
    }

    return input.trim();
  }

  // Check if input looks like a Google Sheets URL
  static isGoogleSheetsUrl(input) {
    if (!input || typeof input !== 'string') {
      return false;
    }

    const trimmed = input.trim().toLowerCase();
    return trimmed.includes('docs.google.com/spreadsheets') || 
           trimmed.includes('sheets.google.com');
  }

  // Check if input looks like an Apps Script URL
  static isAppsScriptUrl(input) {
    if (!input || typeof input !== 'string') {
      return false;
    }

    const trimmed = input.trim().toLowerCase();
    return trimmed.includes('script.google.com') || 
           trimmed.includes('script.googleusercontent.com');
  }

  // Smart parse: detect URL type and extract appropriate ID
  static smartParse(input) {
    const cleaned = this.cleanUrl(input);
    
    if (this.isAppsScriptUrl(cleaned)) {
      return {
        type: 'apps-script',
        url: cleaned,
        id: this.extractAppsScriptId(cleaned),
        valid: this.validateAppsScriptUrl(cleaned)
      };
    }
    
    if (this.isGoogleSheetsUrl(cleaned)) {
      const sheetId = this.extractSheetId(cleaned);
      return {
        type: 'sheets',
        url: cleaned,
        id: sheetId,
        valid: sheetId !== null
      };
    }

    // Check if it's just a Sheet ID
    const sheetId = this.extractSheetId(cleaned);
    if (sheetId) {
      return {
        type: 'sheets-id',
        url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
        id: sheetId,
        valid: true
      };
    }

    return {
      type: 'unknown',
      url: cleaned,
      id: null,
      valid: false
    };
  }

  // Generate user-friendly error messages
  static getValidationMessage(input) {
    const result = this.smartParse(input);
    
    if (result.valid) {
      return null; // No error
    }

    if (!input || input.trim() === '') {
      return 'Please enter a URL or ID';
    }

    if (result.type === 'apps-script') {
      return 'Invalid Apps Script URL. Should look like: https://script.google.com/macros/s/ABC123.../exec';
    }

    if (result.type === 'sheets') {
      return 'Could not extract Sheet ID from URL. Please check the URL format.';
    }

    return 'Invalid format. Please enter a Google Sheets URL, Apps Script URL, or Sheet ID.';
  }
}