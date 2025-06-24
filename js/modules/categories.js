// Category management functionality
import { CONFIG } from '../../config/settings.js';
import { Storage } from '../utils/storage.js';
import { UI } from '../utils/ui.js';
import { Formatters } from '../utils/formatters.js';

export class CategoryManager {
  constructor(sheetsAPI) {
    this.sheetsAPI = sheetsAPI;
    this.categories = Storage.getCategories();
    this.categoryGroups = CONFIG.CATEGORY_GROUPS;
    this.merchantGroups = Storage.getMerchantGroups();
  }

  // Load category data from storage
  loadCategoryData() {
    return {
      categories: this.categories,
      categoryGroups: this.categoryGroups
    };
  }

  // Save categories to storage
  saveCategories(categories) {
    this.categories = categories;
    Storage.saveCategories(categories);
  }

  // Add new category
  addCategory(categoryName, groupName = null) {
    const sanitizedName = Formatters.sanitizeInput(categoryName);
    
    if (!sanitizedName || this.categories.includes(sanitizedName)) {
      return false;
    }

    this.categories.push(sanitizedName);
    
    if (groupName && this.categoryGroups[groupName]) {
      this.categoryGroups[groupName].push(sanitizedName);
    }
    
    this.saveCategories(this.categories);
    return true;
  }

  // Remove category
  removeCategory(categoryName) {
    const index = this.categories.indexOf(categoryName);
    if (index > -1) {
      this.categories.splice(index, 1);
      
      // Remove from groups
      Object.keys(this.categoryGroups).forEach(group => {
        const groupIndex = this.categoryGroups[group].indexOf(categoryName);
        if (groupIndex > -1) {
          this.categoryGroups[group].splice(groupIndex, 1);
        }
      });
      
      this.saveCategories(this.categories);
      return true;
    }
    return false;
  }

  // Find category group
  findCategoryGroup(categoryName) {
    for (const [groupName, categories] of Object.entries(this.categoryGroups)) {
      if (categories.includes(categoryName)) {
        return groupName;
      }
    }
    return null;
  }

  // Auto-categorize merchant
  autoCategorize(merchantName) {
    if (!merchantName) return 'Uncategorized';

    const lowerMerchant = merchantName.toLowerCase();
    
    // Check stored merchant groups first
    for (const [groupName, merchants] of Object.entries(this.merchantGroups)) {
      if (merchants.some(m => lowerMerchant.includes(m.toLowerCase()))) {
        return groupName;
      }
    }

    // Check predefined patterns
    for (const [category, patterns] of Object.entries(CONFIG.MERCHANT_PATTERNS)) {
      if (patterns.some(pattern => lowerMerchant.includes(pattern))) {
        return category;
      }
    }

    return 'Uncategorized';
  }

  // Update category for transaction
  async updateTransactionCategory(sheetId, rowIndex, categoryColIdx, newCategory) {
    try {
      if (!this.categories.includes(newCategory)) {
        throw new Error(`Invalid category: ${newCategory}`);
      }

      const cellRange = `${this.sheetsAPI.numberToLetter(categoryColIdx + 1)}${rowIndex + 1}`;
      await this.sheetsAPI.updateCell(sheetId, cellRange, newCategory);
      
      UI.showToast(`Updated category to ${newCategory}`, 'success', 2000);
      return true;
    } catch (error) {
      UI.handleError(error, 'Updating category');
      return false;
    }
  }

  // Render categories UI with budget-style design
  renderCategories(selectedGroup = null, transactions = []) {
    const container = document.getElementById('categories-list');
    if (!container) return;

    // Get spending data for categories
    const categorySpending = {};
    transactions.forEach(transaction => {
      const category = transaction[7] || 'Uncategorized';
      if (!categorySpending[category]) {
        categorySpending[category] = 0;
      }
      categorySpending[category] += Math.abs(transaction[1]);
    });

    // Organize categories by group
    const categoryGroups = {
      'Living Expenses': [],
      'Lifestyle': [],
      'Financial': [],
      'Personal': []
    };

    // Get all categories from transactions and predefined list
    const allCategories = new Set([...this.categories, ...Object.keys(categorySpending)]);
    
    allCategories.forEach(category => {
      const group = this.findCategoryGroup(category) || 'Personal';
      if (categoryGroups[group]) {
        categoryGroups[group].push({
          name: category,
          spending: categorySpending[category] || 0,
          group: group
        });
      }
    });

    // Filter by selected group if specified
    const groupsToShow = selectedGroup ? { [selectedGroup]: categoryGroups[selectedGroup] } : categoryGroups;

    container.innerHTML = Object.keys(groupsToShow).map(groupName => {
      const categories = groupsToShow[groupName];
      if (categories.length === 0) return '';

      const groupTotal = categories.reduce((sum, cat) => sum + cat.spending, 0);
      
      return `
        <div class="category-group" style="margin-bottom: 2rem;">
          <div class="category-group-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding: 1rem; background: var(--bg-secondary); border-radius: var(--radius-sm);">
            <h3 style="margin: 0; color: var(--text-primary);">${groupName}</h3>
            <div style="display: flex; gap: 1rem; align-items: center;">
              <span style="color: var(--text-secondary); font-size: 0.875rem;">
                Total Spent: $${groupTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style="color: var(--text-secondary); font-size: 0.875rem;">
                ${categories.length} categories
              </span>
            </div>
          </div>
          
          <div class="category-categories" style="display: grid; gap: 0.75rem;">
            ${categories.map(category => {
              return `
                <div class="category-item" style="display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 1rem; align-items: center; padding: 1rem; background: var(--card-bg); border: 1px solid var(--border-light); border-radius: var(--radius-sm);">
                  <div>
                    <div style="font-weight: 500; color: var(--text-primary);">${category.name}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">Category in ${category.group}</div>
                  </div>
                  
                  <div style="text-align: right;">
                    <div style="font-weight: 600; color: var(--text-primary);">
                      $${category.spending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">Total spent</div>
                  </div>
                  
                  <div style="text-align: center;">
                    <select style="padding: 0.25rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 0.75rem;" 
                            onchange="window.budgetApp?.categoryManager?.moveCategory('${category.name}', this.value)">
                      <option value="${category.group}">${category.group}</option>
                      ${Object.keys(categoryGroups).filter(g => g !== category.group).map(g => 
                        `<option value="${g}">${g}</option>`
                      ).join('')}
                    </select>
                    <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: center; margin-top: 0.25rem;">Move to</div>
                  </div>
                  
                  <div style="display: flex; gap: 0.5rem;">
                    <button onclick="window.budgetApp?.categoryManager?.editCategory('${category.name}')" 
                            style="padding: 0.25rem 0.5rem; border: 1px solid var(--border-color); background: var(--card-bg); border-radius: var(--radius-sm); cursor: pointer; font-size: 0.75rem;"
                            title="Edit category">✏️</button>
                    <button onclick="window.budgetApp?.categoryManager?.deleteCategory('${category.name}')" 
                            style="padding: 0.25rem 0.5rem; border: 1px solid var(--error-color); background: var(--card-bg); color: var(--error-color); border-radius: var(--radius-sm); cursor: pointer; font-size: 0.75rem;"
                            title="Delete category">🗑️</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  // Handle category group change
  onCategoryGroupChange() {
    const select = document.getElementById('category-group-select');
    if (!select) return;

    const selectedGroup = select.value;
    this.renderCategories(selectedGroup || null);
  }

  // Create category summary cards
  updateCategorySummaryCards(transactions) {
    const container = document.getElementById('category-summary-cards');
    if (!container) return;

    const categoryTotals = {};
    const totalSpending = transactions.reduce((sum, t) => sum + Math.abs(t[1]), 0);

    transactions.forEach(transaction => {
      const category = transaction[7] || 'Uncategorized';
      categoryTotals[category] = (categoryTotals[category] || 0) + Math.abs(transaction[1]);
    });

    // Sort by amount and take top categories
    const sortedCategories = Object.entries(categoryTotals)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 6);

    container.innerHTML = sortedCategories.map(([category, amount]) => {
      const percentage = Formatters.percentage(amount, totalSpending);
      return `
        <div class="category-card">
          <div class="category-name">${category}</div>
          <div class="category-amount">${Formatters.currency(amount)}</div>
          <div class="category-percentage">${percentage}</div>
        </div>
      `;
    }).join('');
  }

  // Smart categorization suggestions
  getSuggestions(merchantName, amount) {
    const autoCategory = this.autoCategorize(merchantName);
    const suggestions = [autoCategory];

    // Add contextual suggestions based on amount
    if (amount > 100) {
      suggestions.push('Travel', 'Shopping');
    } else if (amount < 20) {
      suggestions.push('Dining', 'Transportation');
    }

    // Remove duplicates and invalid categories
    return [...new Set(suggestions)].filter(cat => this.categories.includes(cat));
  }

  // Merchant group management
  saveMerchantGroups(groups) {
    this.merchantGroups = groups;
    Storage.saveMerchantGroups(groups);
  }

  getMerchantGroups() {
    return this.merchantGroups;
  }

  addMerchantToGroup(merchantName, groupName) {
    if (!this.merchantGroups[groupName]) {
      this.merchantGroups[groupName] = [];
    }
    
    if (!this.merchantGroups[groupName].includes(merchantName)) {
      this.merchantGroups[groupName].push(merchantName);
      this.saveMerchantGroups(this.merchantGroups);
      return true;
    }
    
    return false;
  }

  // Move category to different group
  moveCategory(categoryName, newGroupName) {
    // Remove from old group
    Object.keys(this.categoryGroups).forEach(groupName => {
      const index = this.categoryGroups[groupName].indexOf(categoryName);
      if (index > -1) {
        this.categoryGroups[groupName].splice(index, 1);
      }
    });

    // Add to new group
    if (!this.categoryGroups[newGroupName]) {
      this.categoryGroups[newGroupName] = [];
    }
    
    if (!this.categoryGroups[newGroupName].includes(categoryName)) {
      this.categoryGroups[newGroupName].push(categoryName);
    }

    // Save changes
    Storage.saveCategoryGroups(this.categoryGroups);
    UI.showToast(`Moved ${categoryName} to ${newGroupName}`, 'success');
    
    // Re-render with current transaction data
    if (window.budgetApp) {
      const transactions = window.budgetApp.getFilteredRows();
      this.renderCategories(null, transactions);
    }
  }

  // Edit category name
  editCategory(categoryName) {
    const newName = prompt(`Edit category name:`, categoryName);
    if (newName && newName !== categoryName) {
      // Update in categories list
      const index = this.categories.indexOf(categoryName);
      if (index > -1) {
        this.categories[index] = newName;
      }

      // Update in category groups
      Object.keys(this.categoryGroups).forEach(groupName => {
        const groupIndex = this.categoryGroups[groupName].indexOf(categoryName);
        if (groupIndex > -1) {
          this.categoryGroups[groupName][groupIndex] = newName;
        }
      });

      this.saveCategories(this.categories);
      Storage.saveCategoryGroups(this.categoryGroups);
      UI.showToast(`Renamed category to ${newName}`, 'success');
      
      // Re-render
      if (window.budgetApp) {
        const transactions = window.budgetApp.getFilteredRows();
        this.renderCategories(null, transactions);
      }
    }
  }

  // Delete category
  deleteCategory(categoryName) {
    if (confirm(`Are you sure you want to delete the category "${categoryName}"?`)) {
      // Remove from categories list
      const index = this.categories.indexOf(categoryName);
      if (index > -1) {
        this.categories.splice(index, 1);
      }

      // Remove from category groups
      Object.keys(this.categoryGroups).forEach(groupName => {
        const groupIndex = this.categoryGroups[groupName].indexOf(categoryName);
        if (groupIndex > -1) {
          this.categoryGroups[groupName].splice(groupIndex, 1);
        }
      });

      this.saveCategories(this.categories);
      Storage.saveCategoryGroups(this.categoryGroups);
      UI.showToast(`Deleted category ${categoryName}`, 'success');
      
      // Re-render
      if (window.budgetApp) {
        const transactions = window.budgetApp.getFilteredRows();
        this.renderCategories(null, transactions);
      }
    }
  }
}