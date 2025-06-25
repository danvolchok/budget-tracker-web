// LocalStorage utilities
import { CONFIG } from '../../config/settings.js';

export class Storage {
  static get(key, defaultValue = null) {
    try {
      const value = localStorage.getItem(key);
      if (!value) return defaultValue;
      
      // Try to parse as JSON first, if it fails return as string
      try {
        return JSON.parse(value);
      } catch {
        // If JSON parsing fails, return the raw string value
        return value;
      }
    } catch (error) {
      console.warn('Failed to get localStorage value:', key);
      return defaultValue;
    }
  }

  static set(key, value) {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
      return false;
    }
  }

  static remove(key) {
    localStorage.removeItem(key);
  }

  static clear() {
    localStorage.clear();
  }

  // Budget Tracker specific methods
  static getCredentials() {
    return {
      useAppsScript: this.get(CONFIG.STORAGE_KEYS.USE_APPS_SCRIPT, 'false') === 'true',
      appsScriptUrl: this.get(CONFIG.STORAGE_KEYS.APPS_SCRIPT_URL, '') || '',
      clientId: this.get(CONFIG.STORAGE_KEYS.CLIENT_ID, CONFIG.GOOGLE.DEFAULT_CLIENT_ID) || CONFIG.GOOGLE.DEFAULT_CLIENT_ID,
      apiKey: this.get(CONFIG.STORAGE_KEYS.API_KEY, CONFIG.GOOGLE.DEFAULT_API_KEY) || CONFIG.GOOGLE.DEFAULT_API_KEY,
      sheetId: this.get(CONFIG.STORAGE_KEYS.SHEET_ID, '') || ''
    };
  }

  static saveCredentials(credentials) {
    Object.keys(credentials).forEach(key => {
      const storageKey = CONFIG.STORAGE_KEYS[key.toUpperCase()] || 
                        CONFIG.STORAGE_KEYS[key.replace(/([A-Z])/g, '_$1').toUpperCase()];
      if (storageKey) {
        this.set(storageKey, credentials[key]);
      }
    });
  }

  static getMerchantGroups() {
    return this.get(CONFIG.STORAGE_KEYS.MERCHANT_GROUPS, {});
  }

  static saveMerchantGroups(groups) {
    this.set(CONFIG.STORAGE_KEYS.MERCHANT_GROUPS, groups);
  }

  static getCategoryGroups() {
    return this.get(CONFIG.STORAGE_KEYS.CATEGORY_GROUPS, CONFIG.CATEGORY_GROUPS);
  }

  static saveCategoryGroups(groups) {
    this.set(CONFIG.STORAGE_KEYS.CATEGORY_GROUPS, groups);
  }

  static getCategories() {
    return this.get(CONFIG.STORAGE_KEYS.CATEGORIES, CONFIG.CATEGORIES);
  }

  static saveCategories(categories) {
    this.set(CONFIG.STORAGE_KEYS.CATEGORIES, categories);
  }

  static getCategoryGroups() {
    return this.get(CONFIG.STORAGE_KEYS.CATEGORY_GROUPS, CONFIG.CATEGORY_GROUPS);
  }

  static saveCategoryGroups(groups) {
    this.set(CONFIG.STORAGE_KEYS.CATEGORY_GROUPS, groups);
  }
}