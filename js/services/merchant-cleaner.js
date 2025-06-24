// Merchant Cleaning Service - GPT-4 + Regex Integration
import { CONFIG } from '../../config/settings.js';
import { Storage } from '../utils/storage.js';
import { UI } from '../utils/ui.js';

export class MerchantCleaner {
  constructor() {
    this.openaiApiKey = Storage.get('openai_api_key', '');
    this.cleaningCache = new Map(); // Cache cleaned names to avoid duplicate API calls
    this.regexPatterns = this.initializeRegexPatterns();
  }

  // Initialize common regex patterns for merchant cleaning
  initializeRegexPatterns() {
    return [
      // Walmart variations
      { pattern: /wal[-\s]?mart\s*#?\d*/i, cleanName: 'Wal-Mart' },
      { pattern: /walmart\s*#?\d*/i, cleanName: 'Wal-Mart' },
      
      // Costco variations
      { pattern: /costco\s*(wholesale)?\s*#?\d*/i, cleanName: 'Costco' },
      
      // Tim Hortons variations
      { pattern: /tim\s*hortons?\s*#?\d*/i, cleanName: 'Tim Hortons' },
      
      // McDonald's variations
      { pattern: /mcdonald'?s\s*#?\d*/i, cleanName: "McDonald's" },
      { pattern: /mcdonalds\s*#?\d*/i, cleanName: "McDonald's" },
      
      // Shoppers Drug Mart variations
      { pattern: /shoppers?\s*drug\s*mart\s*#?\d*/i, cleanName: 'Shoppers Drug Mart' },
      
      // Generic store number removal
      { pattern: /^(.+?)\s*#\d+.*$/i, cleanName: '$1' },
      
      // Remove location codes (last resort)
      { pattern: /^(.+?)\s*\d{4,}.*$/i, cleanName: '$1' },
      
      // Clean up extra spaces
      { pattern: /\s+/g, cleanName: ' ' }
    ];
  }

  // Set OpenAI API key
  setApiKey(apiKey) {
    this.openaiApiKey = apiKey;
    Storage.set('openai_api_key', apiKey);
  }

  // Get OpenAI API key
  getApiKey() {
    return this.openaiApiKey || Storage.get('openai_api_key', '');
  }

  // Clean merchant name using regex patterns first
  cleanWithRegex(merchantName) {
    if (!merchantName || typeof merchantName !== 'string') {
      return merchantName;
    }

    let cleaned = merchantName.trim();
    
    // Apply each regex pattern
    for (const { pattern, cleanName } of this.regexPatterns) {
      if (pattern.test(cleaned)) {
        if (cleanName.includes('$1')) {
          // Use regex capture group
          cleaned = cleaned.replace(pattern, cleanName);
        } else {
          // Use fixed clean name
          cleaned = cleanName;
        }
        break; // Stop at first match to avoid over-processing
      }
    }
    
    return cleaned.trim();
  }

  // Clean merchant name using GPT-4 API
  async cleanWithGPT4(merchantName) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Check cache first
    if (this.cleaningCache.has(merchantName)) {
      return this.cleaningCache.get(merchantName);
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // Use cost-effective model for this task
          messages: [
            {
              role: 'system',
              content: `You are a merchant name cleaner for financial transactions. Your job is to:
1. Clean up messy merchant names from credit card transactions
2. Remove store numbers, location codes, and extra identifiers
3. Standardize to the main brand name
4. Keep only the essential business name

Examples:
- "WAL-MART #3454" → "Wal-Mart"
- "TIM HORTONS #2341 DOWNTOWN" → "Tim Hortons"
- "COSTCO WHOLESALE #123" → "Costco"
- "MCDONALD'S #29082 Q04" → "McDonald's"
- "SP NAPOLEON HOME COMFO" → "Napoleon Home Comfort"

Respond with ONLY the cleaned merchant name, nothing else.`
            },
            {
              role: 'user',
              content: `Clean this merchant name: "${merchantName}"`
            }
          ],
          max_tokens: 50,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const cleanedName = data.choices[0]?.message?.content?.trim();
      
      if (cleanedName) {
        // Cache the result
        this.cleaningCache.set(merchantName, cleanedName);
        return cleanedName;
      } else {
        throw new Error('No response from GPT-4');
      }
    } catch (error) {
      console.error('GPT-4 cleaning failed:', error);
      // Fallback to regex cleaning
      return this.cleanWithRegex(merchantName);
    }
  }

  // Main cleaning function - tries regex first, then GPT-4 for complex cases
  async cleanMerchantName(merchantName) {
    if (!merchantName || typeof merchantName !== 'string') {
      return merchantName;
    }

    // Try regex cleaning first (fast and free)
    const regexCleaned = this.cleanWithRegex(merchantName);
    
    // If regex made a significant change, use that result
    if (regexCleaned !== merchantName && regexCleaned.length > 3) {
      this.cleaningCache.set(merchantName, regexCleaned);
      return regexCleaned;
    }

    // For complex cases, use GPT-4 (only if API key is available)
    if (this.getApiKey()) {
      try {
        return await this.cleanWithGPT4(merchantName);
      } catch (error) {
        console.warn('GPT-4 cleaning failed, using regex result:', error);
        return regexCleaned;
      }
    }

    // Fallback to regex result
    return regexCleaned;
  }

  // Bulk clean multiple merchant names
  async cleanMerchantNames(merchantNames) {
    const results = new Map();
    const uniqueNames = [...new Set(merchantNames.filter(name => name && name.trim()))];
    
    let processed = 0;
    const total = uniqueNames.length;
    
    for (const merchantName of uniqueNames) {
      try {
        const cleaned = await this.cleanMerchantName(merchantName);
        results.set(merchantName, cleaned);
        processed++;
        
        // Show progress on loading screen
        if (processed % 2 === 0) {
          UI.setLoadingMessage(`🤖 GPT-4 Cleaning ${processed}/${total}: "${merchantName}" → "${cleaned}"`);
        }
      } catch (error) {
        console.error(`Failed to clean merchant: ${merchantName}`, error);
        results.set(merchantName, merchantName); // Keep original on error
      }
      
      // Small delay to avoid rate limiting
      if (this.getApiKey() && processed % 3 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  // Clear cleaning cache
  clearCache() {
    this.cleaningCache.clear();
    UI.showToast('🗑️ Merchant cleaning cache cleared', 'info');
  }

  // Get cache stats
  getCacheStats() {
    return {
      size: this.cleaningCache.size,
      entries: Array.from(this.cleaningCache.entries())
    };
  }

  // Validate API key
  async validateApiKey(apiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}