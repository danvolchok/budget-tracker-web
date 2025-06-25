// Main application entry point
import { CONFIG } from '../config/settings.js';
import { Storage } from './utils/storage.js';
import { UI } from './utils/ui.js';
import { URLParser } from './utils/url-parser.js';
import { SheetsAPI } from './modules/sheets-api.js';
import { CategoryManager } from './modules/categories.js';
import { ChartManager } from './modules/charts.js';
import { DrivePicker } from './modules/drive-picker.js';
import { MerchantCleaner } from './services/merchant-cleaner.js';

class BudgetTrackerApp {
  constructor() {
    // Initialize core modules
    this.sheetsAPI = new SheetsAPI();
    this.categoryManager = new CategoryManager(this.sheetsAPI);
    this.chartManager = new ChartManager();
    this.drivePicker = new DrivePicker(this.sheetsAPI);
    this.merchantCleaner = new MerchantCleaner();
    
    // Application state
    this.rowsData = [];
    this.currentView = 'dashboard';
    this.currentLimit = CONFIG.UI.DEFAULT_LIMIT;
    this.currentPeriod = 'month';
    this.selectedMonth = new Date().getMonth();
    this.selectedYear = new Date().getFullYear();
    this.selectedDay = null;
    this.transactionSearchTerm = '';
    this.dashboardInitialized = false;
    this.dataChanged = true;
    this.budgets = {};
    this.budgetPeriod = 'payweek'; // Base period for budget storage
    this.currentMerchantStep = 1;
    
    // Merchant editing cache for responsive UI
    this.merchantEditingCache = {
      enabled: false,
      originalData: null,
      pendingChanges: new Map(), // merchantName -> newGroupName
      changedRows: new Set() // row indices that need Google Sheets updates
    };
    
    // Column indices (will be set during data load)
    this.columnIndices = {
      account: -1,
      category: -1,
      recurring: -1,
      merchantGroup: -1,
      isGrouped: -1
    };

    // Cache
    this.filteredRowsCache = [];
    this.categoryCache = {};
  }

  // Initialize the application
  async init() {
    try {
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Setup navigation
      this.setupNavigation();
      
      // Initialize Google APIs
      await this.sheetsAPI.init();
      
      // Setup period controls
      this.setupPeriodControls();
      
      // Initialize with empty views
      this.initializeEmptyViews();
      
    } catch (error) {
      UI.handleError(error, 'Initialization failed');
    }
  }

  // Called when Google APIs are ready
  onAPIsReady() {
    this.sheetsAPI.onAPIsReady();
    
    // Initialize Drive Picker
    this.drivePicker.init();
    
    // Only load data if we have valid credentials
    const credentials = Storage.getCredentials();
    
    if (credentials.useAppsScript && credentials.appsScriptUrl && credentials.sheetId) {
      this.hideConnectionUI();
      this.loadDataFromAppsScript();
    } else if (credentials.sheetId && credentials.apiKey !== CONFIG.GOOGLE.DEFAULT_API_KEY) {
      this.hideConnectionUI();
      this.loadData(credentials.sheetId);
    } else {
      this.showConnectionUI();
      this.initializeEmptyViews();
    }
  }

  // Setup event listeners
  setupEventListeners() {
    // Window resize
    window.addEventListener('resize', () => {
      this.chartManager.resizeCharts();
    });
    
    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Focus search on Ctrl+F or Cmd+F (prevent browser search)
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && this.currentView === 'transactions') {
        e.preventDefault();
        const searchInput = document.getElementById('transaction-search');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }
      
      // Clear search on Escape
      if (e.key === 'Escape' && this.currentView === 'transactions') {
        this.clearTransactionSearch();
      }
    });
  }

  // Setup navigation system
  setupNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const viewName = btn.getAttribute('data-view');
        if (viewName) {
          this.switchView(viewName);
        }
      });
    });
  }

  // Switch between views
  switchView(viewName) {
    // Check if advanced features are accessible for certain views
    if (['budgets', 'categories'].includes(viewName) && this.rowsData.length > 0 && !this.canAccessAdvancedFeatures()) {
      UI.showToast('⚠️ Complete merchant grouping first to access this feature', 'warning');
      // Redirect to merchants view
      viewName = 'merchants';
    }

    // Update navigation
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.app-view').forEach(view => {
      view.classList.remove('active');
      view.style.display = 'none';
    });

    // Show target view
    const targetView = document.getElementById(viewName + '-view');
    const targetNavBtn = document.querySelector(`[data-view="${viewName}"]`);
    
    if (targetView && targetNavBtn) {
      targetView.style.display = 'block';
      targetView.classList.add('active');
      targetNavBtn.classList.add('active');
      this.currentView = viewName;
      this.initializeViewContent(viewName);
    }
  }

  // Initialize content for specific view
  initializeViewContent(viewName) {
    switch (viewName) {
      case 'dashboard':
        // Only update if data has changed, not on every navigation
        if (!this.dashboardInitialized || this.dataChanged) {
          this.updateDashboard();
          this.dashboardInitialized = true;
          this.dataChanged = false;
        }
        break;
      case 'merchants':
        this.renderMerchantsView();
        break;
      case 'categories':
        const transactions = this.getFilteredRows();
        this.categoryManager.renderCategories(null, transactions);
        break;
      case 'transactions':
        this.renderTransactionsView();
        break;
      case 'budgets':
        this.renderBudgetsView();
        break;
    }
  }

  // Connect to Apps Script and show sheet picker
  async openAppsScriptAuth() {
    const appsScriptInput = document.getElementById('apps-script-url');
    const appsScriptUrl = appsScriptInput?.value?.trim();

    if (!appsScriptUrl) {
      UI.showToast('Please enter your Google Apps Script URL', 'error');
      return;
    }

    // Validate Apps Script URL
    const parseResult = URLParser.smartParse(appsScriptUrl);
    if (parseResult.type !== 'apps-script' || !parseResult.valid) {
      const errorMsg = URLParser.getValidationMessage(appsScriptUrl);
      UI.showToast(errorMsg, 'error');
      return;
    }

    try {
      // Store the Apps Script URL
      this.sheetsAPI.updateCredentials({ 
        useAppsScript: true,
        appsScriptUrl: parseResult.url
      });

      // Load available sheets and show picker
      await this.loadAndShowSheetPicker();

    } catch (error) {
      UI.handleError(error, 'Failed to connect to Apps Script');
    }
  }

  // Load sheets from Apps Script and show picker dropdown
  async loadAndShowSheetPicker() {
    try {
      UI.showLoading('Loading your Google Sheets...');

      // Call the listSheets action
      const response = await this.sheetsAPI.appsScriptRequest('GET', {
        action: 'listSheets'
      });

      if (response.error) {
        throw new Error(`Apps Script error: ${response.error}`);
      }

      const sheets = response.sheets || [];
      if (sheets.length === 0) {
        UI.hideLoading();
        UI.showToast('No Google Sheets found in your account', 'warning');
        return;
      }

      UI.hideLoading();
      this.showSheetPicker(sheets);

    } catch (error) {
      UI.hideLoading();
      UI.handleError(error, 'Failed to load sheet list');
    }
  }

  // Show sheet picker interface
  showSheetPicker(sheets) {
    // Create or get sheet picker container
    let pickerContainer = document.getElementById('sheet-picker-container');
    if (!pickerContainer) {
      pickerContainer = document.createElement('div');
      pickerContainer.id = 'sheet-picker-container';
      pickerContainer.style.cssText = 'margin-top: 1rem; padding: 1rem; border: 1px solid var(--border-color); border-radius: 8px; background: var(--card-bg);';
      
      // Find the connection form in the welcome page
      const connectionForm = document.querySelector('.connection-form');
      if (connectionForm) {
        connectionForm.appendChild(pickerContainer);
      } else {
        // Fallback: create picker in welcome card
        const welcomeCard = document.querySelector('.welcome-card');
        if (welcomeCard) {
          welcomeCard.appendChild(pickerContainer);
        }
      }
    }

    // Sort sheets by last modified (most recent first)
    const sortedSheets = sheets.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

    pickerContainer.innerHTML = `
      <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: var(--text-primary);">📊 Select Your Budget Sheet</h3>
      <p style="margin: 0 0 1rem 0; font-size: 0.875rem; color: var(--text-secondary);">Found ${sheets.length} spreadsheet(s) in your Google Drive:</p>
      <select id="sheet-picker-select" class="input-standard" style="width: 100%; margin-bottom: 0.5rem;">
        <option value="">Choose a sheet...</option>
        ${sortedSheets.map(sheet => `
          <option value="${sheet.id}" data-name="${sheet.name}">
            ${sheet.name} (Modified: ${new Date(sheet.lastModified).toLocaleDateString()})
          </option>
        `).join('')}
      </select>
      <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
        <button onclick="window.budgetApp?.cancelSheetSelection()" class="btn btn-secondary">Cancel</button>
        <button onclick="window.budgetApp?.selectSheet()" class="btn btn-primary">Connect to Selected Sheet</button>
      </div>
    `;

    UI.showToast(`Found ${sheets.length} sheets. Please select one to continue.`, 'success');
  }

  // Handle sheet selection
  async selectSheet() {
    const select = document.getElementById('sheet-picker-select');
    const selectedSheetId = select?.value;
    const selectedOption = select?.selectedOptions[0];
    const selectedSheetName = selectedOption?.dataset.name;

    if (!selectedSheetId) {
      UI.showToast('Please select a sheet first', 'error');
      return;
    }

    try {
      // Update credentials with selected sheet
      this.sheetsAPI.updateCredentials({ 
        useAppsScript: true,
        appsScriptUrl: this.sheetsAPI.credentials.appsScriptUrl,
        sheetId: selectedSheetId
      });

      UI.showToast(`Connecting to ${selectedSheetName}...`, 'info');
      
      // Load data from the selected sheet
      await this.loadDataFromAppsScript();
      
      // Hide the connection UI and sheet picker
      this.hideConnectionUI();
      this.hideSheetPicker();

    } catch (error) {
      UI.handleError(error, 'Connection failed');
    }
  }

  // Cancel sheet selection
  cancelSheetSelection() {
    this.hideSheetPicker();
    UI.showToast('Sheet selection cancelled', 'info');
  }

  // Hide sheet picker
  hideSheetPicker() {
    const pickerContainer = document.getElementById('sheet-picker-container');
    if (pickerContainer) {
      pickerContainer.remove();
    }
  }

  // Browse Google Sheets using Drive Picker
  async browseSheets() {
    try {
      await this.drivePicker.showPicker();
    } catch (error) {
      UI.handleError(error, 'Failed to browse sheets');
    }
  }

  // Connect to Google Sheets (Alternative method)
  async connectToSheet() {
    const sheetInput = document.getElementById('sheet-url-input');
    const sheetInput2 = document.getElementById('sheet-id-input'); // Fallback
    const input = sheetInput?.value?.trim() || sheetInput2?.value?.trim();

    if (!input) {
      UI.showToast('Please enter a Google Sheets URL or Sheet ID', 'error');
      return;
    }

    // Parse the input to extract Sheet ID
    const parseResult = URLParser.smartParse(input);
    
    if (!parseResult.valid || !parseResult.id) {
      const errorMsg = URLParser.getValidationMessage(input);
      UI.showToast(errorMsg, 'error');
      return;
    }

    const sheetId = parseResult.id;

    try {
      // Update credentials with the new sheet ID (non-Apps Script mode)
      this.sheetsAPI.updateCredentials({ 
        useAppsScript: false,
        sheetId: sheetId
      });
      
      const success = await this.sheetsAPI.connect(sheetId);
      if (success) {
        await this.loadData(sheetId);
        this.hideConnectionUI();
      }
    } catch (error) {
      UI.handleError(error, 'Connection failed');
    }
  }

  // Load data from Apps Script
  async loadDataFromAppsScript() {
    try {
      UI.showLoading('Connecting to Google Apps Script...');
      UI.setStep(1, 'Connecting to Google Apps Script...');
      UI.setProgress(10);
      
      const credentials = Storage.getCredentials();
      const response = await this.sheetsAPI.appsScriptRequest('GET', {
        sheetId: credentials.sheetId,
        range: 'Sheet1!A:Z'
      });

      if (response.error) {
        throw new Error(`Apps Script error: ${response.error}`);
      }

      UI.setStep(2, 'Loading transaction data...');
      UI.setProgress(30);
      
      const dataRows = response.values || [];
      this.rowsData = dataRows;
      
      // Calculate and show stats
      const transactionCount = Math.max(0, dataRows.length - 1); // Exclude header
      UI.updateStats(transactionCount, 0, 0);
      
      UI.setStep(3, 'Processing column structure...');
      UI.setProgress(50);
      
      // Find column indices
      await this.findColumnIndices();
      
      // Count unique merchants
      const uniqueMerchants = this.countUniqueMerchants();
      UI.updateStats(transactionCount, uniqueMerchants, 0);
      
      UI.setStep(4, 'Auto-cleaning merchant names...');
      UI.setProgress(70);
      
      // Auto-clean new merchants and track how many were cleaned
      const cleanedCount = await this.autoCleanNewMerchants();
      UI.updateStats(transactionCount, uniqueMerchants, cleanedCount || 0);
      
      UI.setStep(5, 'Updating dashboard...');
      UI.setProgress(90);
      
      // Process transactions
      const transactions = this.processTransactions();
      
      // Don't update UI components yet - wait for user to enter app
      
      UI.setProgress(100);
      UI.setStep(5, 'Loading complete! Ready to enter app.');
      
      // Show the Enter App button instead of auto-hiding
      setTimeout(() => {
        UI.showEnterAppButton();
      }, 1000);
      
      // Store the transactions for when user enters app
      this.loadedTransactions = transactions;
      
    } catch (error) {
      UI.hideLoading();
      UI.handleError(error, 'Loading data from Apps Script');
    }
  }

  // Load data from Google Sheets
  async loadData(sheetId) {
    try {
      UI.showLoading('Connecting to Google Sheets API...');
      UI.setStep(1, 'Connecting to Google Sheets API...');
      UI.setProgress(10);
      
      const dataRows = await this.sheetsAPI.loadData(sheetId);
      
      UI.setStep(2, 'Loading transaction data...');
      UI.setProgress(30);
      
      this.rowsData = dataRows;
      
      // Calculate and show stats
      const transactionCount = Math.max(0, dataRows.length - 1); // Exclude header
      UI.updateStats(transactionCount, 0, 0);
      
      UI.setStep(3, 'Processing column structure...');
      UI.setProgress(50);
      
      // Find column indices
      await this.findColumnIndices();
      
      // Count unique merchants
      const uniqueMerchants = this.countUniqueMerchants();
      UI.updateStats(transactionCount, uniqueMerchants, 0);
      
      UI.setStep(4, 'Auto-cleaning merchant names...');
      UI.setProgress(70);
      
      // Auto-clean new merchants and track how many were cleaned
      const cleanedCount = await this.autoCleanNewMerchants();
      UI.updateStats(transactionCount, uniqueMerchants, cleanedCount || 0);
      
      UI.setStep(5, 'Updating dashboard...');
      UI.setProgress(90);
      
      // Process transactions
      const transactions = this.processTransactions();
      
      // Don't update UI components yet - wait for user to enter app
      
      UI.setProgress(100);
      UI.setStep(5, 'Loading complete! Ready to enter app.');
      
      // Show the Enter App button instead of auto-hiding
      setTimeout(() => {
        UI.showEnterAppButton();
      }, 1000);
      
      // Store the transactions for when user enters app
      this.loadedTransactions = transactions;
      
    } catch (error) {
      UI.hideLoading();
      UI.handleError(error, 'Loading data');
    }
  }

  // Find column indices in the spreadsheet
  async findColumnIndices() {
    const headers = this.rowsData[0] || [];
    
    this.columnIndices.account = headers.findIndex(h => 
      h && h.toLowerCase().includes('account')
    );
    
    this.columnIndices.category = headers.findIndex(h => 
      h && h.toLowerCase().includes('category') && !h.toLowerCase().includes('group')
    );
    
    this.columnIndices.categoryGroup = headers.findIndex(h => 
      h && h.toLowerCase().includes('category') && h.toLowerCase().includes('group')
    );
    
    this.columnIndices.recurring = headers.findIndex(h => 
      h && h.toLowerCase().includes('recurring')
    );
    
    this.columnIndices.merchantGroup = headers.findIndex(h => 
      h && h.toLowerCase().includes('merchant') && h.toLowerCase().includes('group')
    );
    
    this.columnIndices.merchant = headers.findIndex(h => 
      h && h.toLowerCase().includes('merchant') && !h.toLowerCase().includes('group')
    );
    
    this.columnIndices.payweek = headers.findIndex(h => 
      h && h.toLowerCase().includes('payweek')
    );
    
    this.columnIndices.budget = headers.findIndex(h => 
      h && h.toLowerCase().includes('budget')
    );
    
    this.columnIndices.isGrouped = headers.findIndex(h => 
      h && h.toLowerCase().includes('grouped')
    );


    // Ensure required columns exist
    const credentials = Storage.getCredentials();
    const sheetId = credentials.sheetId || Storage.get(CONFIG.STORAGE_KEYS.SHEET_ID);
    
    if (this.columnIndices.category === -1) {
      this.columnIndices.category = await this.sheetsAPI.ensureColumn(sheetId, 'Category');
    }
    
    if (this.columnIndices.budget === -1) {
      this.columnIndices.budget = await this.sheetsAPI.ensureColumn(sheetId, 'Budget');
    }
    
    if (this.columnIndices.merchantGroup === -1) {
      this.columnIndices.merchantGroup = await this.sheetsAPI.ensureColumn(sheetId, 'Merchant Group');
    }
  }

  // Process raw spreadsheet data into transactions
  processTransactions() {
    return this.rowsData.slice(1).map(row => {
      const account = this.getColumnValue(row, 'account') || 'Uncategorized';
      const amount = parseFloat(row[1]) || 0;
      const merchant = row[2] || '';
      const description = row[3] || '';
      const date = row[4] || '';
      const id = row[5] || '';
      const notes = row[6] || '';
      const category = this.getColumnValue(row, 'category') || 'Uncategorized';
      
      return [account, amount, merchant, description, date, id, notes, category];
    });
  }

  // Get value from specific column
  getColumnValue(row, columnType) {
    const colIndex = this.columnIndices[columnType];
    return colIndex !== -1 && row[colIndex] ? row[colIndex] : null;
  }

  // Update all views with new data
  updateAllViews(transactions) {
    this.dataChanged = true; // Mark data as changed for dashboard
    this.updateSummaryCards(transactions);
    this.categoryManager.updateCategorySummaryCards(transactions);
    this.chartManager.updateAllCharts(transactions);
    this.updateQuickStats(transactions);
    this.renderRecentTable(transactions);
    // Don't call updateCurrentView() here to avoid infinite loop
  }

  // Initialize views with empty state
  initializeEmptyViews() {
    // Ensure loading is hidden
    UI.hideLoading();
    
    this.updateSummaryCards([]);
    this.categoryManager.updateCategorySummaryCards([]);
    this.updateQuickStats([]);
    this.renderRecentTable([]);
    
    // Update chart title to show empty state
    const chartTitle = document.querySelector('#dashboard-view .chart-title');
    if (chartTitle) {
      chartTitle.textContent = '📊 Connect to Google Sheets to view data';
    }
  }

  // Update quick stats display
  updateQuickStats(transactions) {
    const now = new Date();
    
    // Calculate week spending (current week)
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekSpending = transactions
      .filter(t => new Date(t[4]) >= weekStart)
      .reduce((sum, t) => sum + Math.abs(t[1]), 0);
    
    // Calculate month spending (current month)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthSpending = transactions
      .filter(t => new Date(t[4]) >= monthStart)
      .reduce((sum, t) => sum + Math.abs(t[1]), 0);
    
    // Calculate year spending (current year)
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearSpending = transactions
      .filter(t => new Date(t[4]) >= yearStart)
      .reduce((sum, t) => sum + Math.abs(t[1]), 0);
    
    // Update display
    const weekEl = document.getElementById('stat-week');
    const monthEl = document.getElementById('stat-month');
    const yearEl = document.getElementById('stat-year');
    
    if (weekEl) weekEl.textContent = `$${weekSpending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (monthEl) monthEl.textContent = `$${monthSpending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (yearEl) yearEl.textContent = `$${yearSpending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  // Update summary cards
  updateSummaryCards(transactions) {
    const totalSpending = transactions.reduce((sum, t) => sum + Math.abs(t[1]), 0);
    const transactionCount = transactions.length;
    const avgTransaction = transactionCount > 0 ? totalSpending / transactionCount : 0;

    // Update card values
    document.querySelectorAll('.summary-card').forEach((card, index) => {
      const valueElement = card.querySelector('.card-value');
      if (valueElement) {
        switch (index) {
          case 0:
            valueElement.textContent = `$${totalSpending.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}`;
            break;
          case 1:
            valueElement.textContent = transactionCount.toLocaleString();
            break;
          case 2:
            valueElement.textContent = `$${avgTransaction.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}`;
            break;
        }
      }
    });
  }

  // Render recent transactions table
  renderRecentTable(transactions = null) {
    const tbody = document.querySelector('#recent-table tbody');
    if (!tbody) return;

    const filteredTransactions = transactions || this.getFilteredRows();
    const recentTransactions = filteredTransactions
      .sort((a, b) => new Date(b[4]) - new Date(a[4]))
      .slice(0, this.currentLimit);

    tbody.innerHTML = recentTransactions.map((transaction, rowIndex) => {
      const [account, amount, merchant, description, date, , , category] = transaction;
      
      // Get the actual row from the spreadsheet data (add 1 to skip header)
      const actualRowIndex = rowIndex + 1;
      const actualRow = this.rowsData[actualRowIndex] || [];
      
      // Get category group from actual column
      const categoryGroup = this.getColumnValue(actualRow, 'categoryGroup') || 
                           this.categoryManager.findCategoryGroup(category) || '–';
      
      // Use Merchant Group first, then fallback to Merchant
      const merchantGroupCol = this.getColumnValue(actualRow, 'merchantGroup');
      const merchantCol = this.getColumnValue(actualRow, 'merchant') || merchant;
      const displayMerchant = merchantGroupCol || merchantCol;
      
      // Get payweek from actual column
      const payweekCol = this.getColumnValue(actualRow, 'payweek') || description;
      
      return `
        <tr>
          <td>${new Date(date).toLocaleDateString()}</td>
          <td>${account}</td>
          <td>${category}</td>
          <td>${categoryGroup}</td>
          <td>$${Math.abs(amount).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })}</td>
          <td>${displayMerchant}</td>
          <td>${payweekCol}</td>
        </tr>
      `;
    }).join('');
  }

  // Get filtered transactions based on current period
  getFilteredRows() {
    if (this.rowsData.length === 0) return [];
    
    const transactions = this.processTransactions();
    const now = new Date();
    
    return transactions.filter(transaction => {
      const transactionDate = new Date(transaction[4]); // Date is at index 4
      
      switch (this.currentPeriod) {
        case 'week':
          const weekStart = new Date(now);
          weekStart.setDate(now.getDate() - now.getDay()); // Start of current week
          weekStart.setHours(0, 0, 0, 0);
          return transactionDate >= weekStart;
          
        case 'payweek':
          // Assuming payweek is bi-weekly, starting from a reference date
          const payweekStart = new Date(now);
          const daysSinceRef = Math.floor((now - new Date(now.getFullYear(), 0, 1)) / (1000 * 60 * 60 * 24));
          const payweekNumber = Math.floor(daysSinceRef / 14);
          payweekStart.setTime(new Date(now.getFullYear(), 0, 1).getTime() + (payweekNumber * 14 * 24 * 60 * 60 * 1000));
          return transactionDate >= payweekStart;
          
        case 'month':
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          return transactionDate >= monthStart;
          
        case 'year':
          const yearStart = new Date(now.getFullYear(), 0, 1);
          return transactionDate >= yearStart;
          
        default:
          return true;
      }
    });
  }

  // Setup period controls for both dashboard and transactions views
  setupPeriodControls() {
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const period = btn.getAttribute('data-period');
        if (period) {
          this.changePeriod(period);
        }
      });
    });
    
    // Set default active period
    this.changePeriod('month');
  }

  // Handle period changes across all views
  changePeriod(newPeriod) {
    // Update current period
    this.currentPeriod = newPeriod;
    
    // Update button active states in both views
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.getAttribute('data-period') === newPeriod) {
        btn.classList.add('active');
      }
    });
    
    // Update period display text
    this.updatePeriodText();
    
    // Refresh current view based on what's active
    if (this.currentView === 'dashboard') {
      this.updateComparisonData();
      this.updateDashboard();
    } else if (this.currentView === 'transactions') {
      this.renderTransactionsView();
    }
  }

  // Update period text display
  updatePeriodText() {
    const periodText = document.getElementById('current-period-text');
    if (periodText) {
      const now = new Date();
      let text = '';
      
      switch (this.currentPeriod) {
        case 'week':
          text = `Week of ${now.toLocaleDateString()}`;
          break;
        case 'payweek':
          text = `Payweek of ${now.toLocaleDateString()}`;
          break;
        case 'month':
          text = `${now.toLocaleDateString('default', { month: 'long', year: 'numeric' })}`;
          break;
        case 'year':
          text = `${now.getFullYear()}`;
          break;
      }
      
      periodText.textContent = text;
    }
  }

  // Update data based on period selection
  updateComparisonData() {
    const transactions = this.getFilteredRows();
    this.updateSummaryCards(transactions);
    this.categoryManager.updateCategorySummaryCards(transactions);
    this.chartManager.drawSpendingChart(transactions);
    this.renderRecentTable(transactions);
  }

  // Update current view
  updateCurrentView() {
    this.initializeViewContent(this.currentView);
  }

  // Hide connection UI after successful connection
  hideConnectionUI() {
    const welcomePage = document.getElementById('welcome-page');
    const mainApp = document.getElementById('main-app');
    
    if (welcomePage) {
      welcomePage.style.display = 'none';
    }
    
    if (mainApp) {
      mainApp.style.display = 'block';
    }
  }

  // Show connection UI (for disconnection)
  showConnectionUI() {
    const welcomePage = document.getElementById('welcome-page');
    const mainApp = document.getElementById('main-app');
    
    if (welcomePage) {
      welcomePage.style.display = 'block';
    }
    
    if (mainApp) {
      mainApp.style.display = 'none';
    }
  }

  // Show sheet changer
  showSheetChanger() {
    const credentials = Storage.getCredentials();
    if (credentials.useAppsScript && credentials.appsScriptUrl) {
      this.loadAndShowSheetPicker();
    } else {
      UI.showToast('No Apps Script connection found', 'error');
    }
  }

  // Disconnect from current sheet
  disconnect() {
    // Clear credentials
    this.sheetsAPI.updateCredentials({
      useAppsScript: false,
      appsScriptUrl: '',
      sheetId: ''
    });
    
    // Clear data
    this.rowsData = [];
    
    // Reset UI
    this.showConnectionUI();
    this.hideSheetPicker();
    this.initializeEmptyViews();
    
    // Clear input
    const appsScriptInput = document.getElementById('apps-script-url');
    if (appsScriptInput) {
      appsScriptInput.value = '';
    }
    
    UI.showToast('Disconnected successfully', 'success');
  }

  // Get filtered transaction rows based on current period and search
  getFilteredRows() {
    if (!this.rowsData || this.rowsData.length <= 1) {
      return [];
    }

    // Skip header row (index 0)
    const transactions = this.rowsData.slice(1);
    
    // If no period filtering, return all transactions
    if (!this.currentPeriod) {
      return transactions;
    }

    const now = new Date();
    
    return transactions.filter(transaction => {
      const dateStr = transaction[4]; // Date column
      if (!dateStr) return false;
      
      const transactionDate = new Date(dateStr);
      if (isNaN(transactionDate.getTime())) return false;

      switch (this.currentPeriod) {
        case 'week':
          // Current calendar week (Sunday to Saturday)
          const weekStart = new Date(now);
          weekStart.setDate(now.getDate() - now.getDay());
          weekStart.setHours(0, 0, 0, 0);
          
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          weekEnd.setHours(23, 59, 59, 999);
          
          return transactionDate >= weekStart && transactionDate <= weekEnd;

        case 'payweek':
          // Bi-weekly pay period - use payweek column if available
          const payweekValue = this.getColumnValue(transaction, 'payweek');
          if (payweekValue) {
            // If we have payweek data, use current payweek
            return this.isCurrentPayweek(transactionDate, payweekValue);
          } else {
            // Fallback to current 2-week period
            const twoWeeksAgo = new Date(now);
            twoWeeksAgo.setDate(now.getDate() - 14);
            return transactionDate >= twoWeeksAgo;
          }

        case 'month':
          return transactionDate.getMonth() === this.selectedMonth && 
                 transactionDate.getFullYear() === this.selectedYear;

        case 'year':
          return transactionDate.getFullYear() === this.selectedYear;

        default:
          return true;
      }
    });
  }

  // Helper function to check if transaction is in current payweek
  isCurrentPayweek(transactionDate) {
    // Simple payweek logic - you can enhance this based on your payweek system
    const now = new Date();
    const daysDiff = Math.floor((now - transactionDate) / (1000 * 60 * 60 * 24));
    return daysDiff <= 14; // Within last 2 weeks
  }

  // Render specific views
  renderAccountsView() {
  }

  renderTransactionsView() {
    // Render transactions table with period and search filtering
    const tbody = document.querySelector('#transactions-table tbody');
    if (!tbody) return;

    // Start with period-filtered transactions
    let filteredTransactions = this.getFilteredRows();
    
    // REBUILT: Apply simple search filter
    if (this.transactionSearchTerm) {
      const searchTerm = this.transactionSearchTerm;
      
      filteredTransactions = filteredTransactions.filter((transaction) => {
        const [account, amount, merchant, description, date, , , category] = transaction;
        
        // Get the merchant display value (same logic as in table display)
        const actualRowIndex = this.rowsData.findIndex(row => 
          row[0] === account && 
          parseFloat(row[1]) === parseFloat(amount) && 
          row[2] === merchant &&
          row[3] === description &&
          row[4] === date
        );
        
        let displayMerchant = merchant || '';
        if (actualRowIndex > 0) { // Found matching row
          const actualRow = this.rowsData[actualRowIndex];
          const merchantGroupCol = this.getColumnValue(actualRow, 'merchantGroup');
          displayMerchant = merchantGroupCol || merchant || '';
        }
        
        // Simple search across key fields
        const searchableText = [
          account || '',
          displayMerchant,
          category || '',
          description || '',
          amount?.toString() || ''
        ].join(' ').toLowerCase();
        
        return searchableText.includes(searchTerm);
      });
    }
    
    const sortedTransactions = filteredTransactions
      .sort((a, b) => new Date(b[4]) - new Date(a[4])); // Sort by date, newest first

    // Update the header to show transaction count
    const chartTitle = document.querySelector('#transactions-view .chart-title');
    if (chartTitle) {
      const totalCount = this.rowsData.length - 1; // Exclude header
      const filteredCount = sortedTransactions.length;
      const searchText = this.transactionSearchTerm ? ` • Search: "${this.transactionSearchTerm}"` : '';
      const periodText = this.currentPeriod ? ` • ${this.currentPeriod.charAt(0).toUpperCase() + this.currentPeriod.slice(1)}` : '';
      
      chartTitle.innerHTML = `💰 Transaction Management <span style="font-size: 0.875rem; color: var(--text-secondary); font-weight: normal;">(${filteredCount} of ${totalCount}${periodText}${searchText})</span>`;
    }

    tbody.innerHTML = sortedTransactions.map((transaction, rowIndex) => {
      const [account, amount, merchant, description, date, , , category] = transaction;
      
      // Get the actual row from the spreadsheet data (add 1 to skip header)
      const actualRowIndex = rowIndex + 1;
      const actualRow = this.rowsData[actualRowIndex] || [];
      
      // Get category group from actual column
      const categoryGroup = this.getColumnValue(actualRow, 'categoryGroup') || 
                           this.categoryManager.findCategoryGroup(category) || '–';
      
      // Use Merchant Group first, then fallback to Merchant
      const merchantGroupCol = this.getColumnValue(actualRow, 'merchantGroup');
      const merchantCol = this.getColumnValue(actualRow, 'merchant') || merchant;
      const displayMerchant = merchantGroupCol || merchantCol;
      
      // Get payweek from actual column
      const payweekCol = this.getColumnValue(actualRow, 'payweek') || description;
      
      return `
        <tr>
          <td>${new Date(date).toLocaleDateString()}</td>
          <td>${account}</td>
          <td>${category}</td>
          <td>${categoryGroup}</td>
          <td>$${Math.abs(amount).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })}</td>
          <td>${displayMerchant}</td>
          <td>${payweekCol}</td>
        </tr>
      `;
    }).join('');
  }

  updateDashboard() {
    const transactions = this.getFilteredRows();
    this.updateAllViews(transactions);
  }

  // Render budgets view
  renderBudgetsView() {
    const container = document.getElementById('budget-groups-container');
    if (!container) return;

    const transactions = this.getFilteredRows();
    const categoryGroups = {
      'Living Expenses': [],
      'Lifestyle': [],
      'Financial': [],
      'Personal': []
    };

    // Get unique categories and their spending
    const categorySpending = {};
    transactions.forEach(transaction => {
      const category = transaction[7] || 'Uncategorized';
      if (!categorySpending[category]) {
        categorySpending[category] = 0;
      }
      categorySpending[category] += Math.abs(transaction[1]);
    });

    // Organize categories by group
    Object.keys(categorySpending).forEach(category => {
      const group = this.categoryManager.findCategoryGroup(category) || 'Personal';
      if (categoryGroups[group]) {
        categoryGroups[group].push({
          name: category,
          spending: categorySpending[category],
          budget: this.budgets[category] || 0
        });
      }
    });

    // Load saved budgets
    this.loadBudgets();

    // Render budget interface
    container.innerHTML = Object.keys(categoryGroups).map(groupName => {
      const categories = categoryGroups[groupName];
      if (categories.length === 0) return '';

      const groupTotal = categories.reduce((sum, cat) => sum + cat.spending, 0);
      const groupBudget = categories.reduce((sum, cat) => {
        const baseBudget = this.budgets[cat.name] || 0;
        return sum + this.convertBudgetFromBase(baseBudget, this.budgetPeriod);
      }, 0);
      
      return `
        <div class="budget-group" style="margin-bottom: 2rem;">
          <div class="budget-group-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding: 1rem; background: var(--bg-secondary); border-radius: var(--radius-sm);">
            <h3 style="margin: 0; color: var(--text-primary);">${groupName}</h3>
            <div style="display: flex; gap: 1rem; align-items: center;">
              <span style="color: var(--text-secondary); font-size: 0.875rem;">
                Spent: $${groupTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style="color: var(--text-secondary); font-size: 0.875rem;">
                Budget: $${groupBudget.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style="color: ${groupBudget > 0 ? (groupTotal > groupBudget ? 'var(--error-color)' : 'var(--success-color)') : 'var(--text-muted)'}; font-weight: 600;">
                ${groupBudget > 0 ? `${((groupTotal / groupBudget) * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
          </div>
          
          <div class="budget-categories" style="display: grid; gap: 0.75rem;">
            ${categories.map(category => {
              const baseBudgetAmount = this.budgets[category.name] || 0;
              const displayBudgetAmount = this.convertBudgetFromBase(baseBudgetAmount, this.budgetPeriod);
              const percentage = displayBudgetAmount > 0 ? (category.spending / displayBudgetAmount) * 100 : 0;
              const isOverBudget = displayBudgetAmount > 0 && category.spending > displayBudgetAmount;
              
              return `
                <div class="budget-item" style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 1rem; align-items: center; padding: 1rem; background: var(--card-bg); border: 1px solid var(--border-light); border-radius: var(--radius-sm);">
                  <div>
                    <div style="font-weight: 500; color: var(--text-primary);">${category.name}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">Current spending</div>
                  </div>
                  
                  <div style="text-align: right;">
                    <div style="font-weight: 600; color: var(--text-primary);">
                      $${category.spending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  
                  <div>
                    <input 
                      type="number" 
                      value="${displayBudgetAmount.toFixed(2)}" 
                      placeholder="0.00" 
                      step="0.01" 
                      min="0"
                      style="width: 100%; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); text-align: right;"
                      onchange="window.budgetApp?.updateBudget('${category.name}', this.value)"
                    >
                    <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: center; margin-top: 0.25rem;">Budget (${this.budgetPeriod})</div>
                  </div>
                  
                  <div style="text-align: center;">
                    <div style="font-weight: 600; color: ${isOverBudget ? 'var(--error-color)' : displayBudgetAmount > 0 ? 'var(--success-color)' : 'var(--text-muted)'};">
                      ${displayBudgetAmount > 0 ? `${percentage.toFixed(1)}%` : '—'}
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">Used</div>
                  </div>
                  
                  <div style="width: 100px;">
                    <div style="background: var(--bg-secondary); height: 8px; border-radius: 4px; overflow: hidden;">
                      <div style="
                        width: ${Math.min(percentage, 100)}%; 
                        height: 100%; 
                        background: ${isOverBudget ? 'var(--error-color)' : 'var(--success-color)'};
                        transition: width 0.3s ease;
                      "></div>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  // Update budget for a category
  updateBudget(categoryName, amount) {
    // Convert the entered amount back to payweek base before storing
    const baseAmount = this.convertBudgetToBase(parseFloat(amount) || 0, this.budgetPeriod);
    this.budgets[categoryName] = baseAmount;
    this.saveBudgets();
  }

  // Convert budget period
  onBudgetPeriodChange(newPeriod) {
    this.budgetPeriod = newPeriod;
    this.renderBudgetsView(); // Re-render with new period values
  }

  // Convert budget from base payweek to target period
  convertBudgetFromBase(baseAmount, targetPeriod) {
    const payweeksPerYear = 26;
    
    switch (targetPeriod) {
      case 'payweek':
        return baseAmount;
      case 'week':
        return baseAmount / 2; // payweek is 2 weeks
      case 'month':
        return (baseAmount * payweeksPerYear) / 12; // Convert to yearly, then monthly
      case 'year':
        return baseAmount * payweeksPerYear;
      default:
        return baseAmount;
    }
  }

  // Convert budget from any period back to base payweek
  convertBudgetToBase(amount, sourcePeriod) {
    const payweeksPerYear = 26;
    
    switch (sourcePeriod) {
      case 'payweek':
        return amount;
      case 'week':
        return amount * 2; // week to payweek
      case 'month':
        return (amount * 12) / payweeksPerYear; // monthly to yearly, then to payweek
      case 'year':
        return amount / payweeksPerYear;
      default:
        return amount;
    }
  }

  // Save budgets to Google Sheets
  async saveBudgets() {
    try {
      UI.showLoading('Saving budgets to Google Sheets...');
      
      const credentials = Storage.getCredentials();
      const sheetId = credentials.sheetId;
      
      // Find the budget column letter
      const budgetColLetter = this.sheetsAPI.numberToLetter(this.columnIndices.budget + 1);
      
      // Update budget values for each category
      const updatePromises = [];
      
      for (let i = 1; i < this.rowsData.length; i++) {
        const row = this.rowsData[i];
        const category = this.getColumnValue(row, 'category');
        
        if (category && this.budgets[category] !== undefined) {
          const rowNumber = i + 1; // +1 because sheets are 1-indexed
          const range = `${budgetColLetter}${rowNumber}`;
          const budgetValue = this.budgets[category];
          
          updatePromises.push(
            this.sheetsAPI.updateCell(sheetId, range, budgetValue)
          );
        }
      }
      
      await Promise.all(updatePromises);
      
      UI.hideLoading();
      UI.showToast('Budgets saved to Google Sheets successfully!', 'success');
      
    } catch (error) {
      UI.hideLoading();
      UI.handleError(error, 'Failed to save budgets');
    }
  }

  // Load budgets from Google Sheets
  loadBudgets() {
    // Build budgets object from current transaction data
    this.budgets = {};
    
    // Skip header row and process each transaction
    for (let i = 1; i < this.rowsData.length; i++) {
      const row = this.rowsData[i];
      const category = this.getColumnValue(row, 'category');
      const budgetValue = this.getColumnValue(row, 'budget');
      
      if (category && budgetValue && !isNaN(parseFloat(budgetValue))) {
        this.budgets[category] = parseFloat(budgetValue);
      }
    }
  }

  // Merchant Management System
  setMerchantStep(step) {
    this.currentMerchantStep = step;
    
    // Update step buttons
    document.querySelectorAll('.merchant-step-btn').forEach(btn => {
      btn.classList.remove('active');
      btn.style.cssText = 'padding: 0.75rem 1.5rem; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-secondary); border-radius: var(--radius-sm); cursor: pointer; font-weight: 500;';
    });
    
    const activeBtn = document.querySelector(`[data-step="${step}"]`);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.style.cssText = 'padding: 0.75rem 1.5rem; border: none; background: var(--primary-color); color: white; border-radius: var(--radius-sm); cursor: pointer; font-weight: 500;';
    }
    
    this.renderMerchantStepContent();
  }

  renderMerchantsView() {
    this.setMerchantStep(this.currentMerchantStep);
  }

  renderMerchantStepContent() {
    const container = document.getElementById('merchant-step-content');
    if (!container) return;

    const transactions = this.getFilteredRows();
    
    switch (this.currentMerchantStep) {
      case 1:
        this.renderMerchantGroupStep(container, transactions);
        break;
      case 2:
        this.renderCategorizeGroupsStep(container, transactions);
        break;
      case 3:
        this.renderCategoryGroupsStep(container, transactions);
        break;
    }
  }

  // Step 1: Consolidate merchants into merchant groups
  renderMerchantGroupStep(container) {
    // Get all unique merchants from transactions with their merchant groups
    const merchantCounts = {};
    const merchantToGroupMap = {};
    
    // Read merchant groups directly from the raw data
    for (let i = 1; i < this.rowsData.length; i++) {
      const row = this.rowsData[i];
      const merchant = this.getColumnValue(row, 'merchant') || row[2] || 'Unknown';
      const merchantGroup = this.getColumnValue(row, 'merchantGroup');
      
      merchantCounts[merchant] = (merchantCounts[merchant] || 0) + 1;
      if (merchantGroup && merchantGroup.trim()) {
        merchantToGroupMap[merchant] = merchantGroup.trim();
      }
    }

    // Check if any merchant groups already exist
    const hasExistingGroups = Object.keys(merchantToGroupMap).length > 0;

    // If no existing groups, show smart grouping first
    if (!hasExistingGroups) {
      this.showSmartGroupingDialog(merchantCounts);
      return;
    }

    // Build merchant groups from Google Sheets data
    const merchantGroups = {};
    Object.entries(merchantToGroupMap).forEach(([merchant, group]) => {
      if (!merchantGroups[group]) {
        merchantGroups[group] = [];
      }
      if (!merchantGroups[group].includes(merchant)) {
        merchantGroups[group].push(merchant);
      }
    });

    // Sort merchants by frequency (most common first)
    const sortedMerchants = Object.entries(merchantCounts)
      .sort(([,a], [,b]) => b - a)
      .map(([merchant, count]) => ({ merchant, count }));

    container.innerHTML = `
      <div style="margin-bottom: 2rem;">
        <h3 style="color: var(--text-primary); margin-bottom: 0.5rem;">Step 1: Consolidate Similar Merchants</h3>
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
          Group similar merchants together (e.g., "McDonald's #123", "McDonald's Downtown" → "McDonald's Group").
          This makes categorization much easier in the next steps.
        </p>
        
        <div style="display: flex; gap: 1rem; margin-bottom: 1.5rem; align-items: center;">
          <input type="text" id="new-merchant-group" placeholder="Enter new group name..." 
                 style="padding: 0.5rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); flex: 1;">
          <button onclick="window.budgetApp?.createMerchantGroup()" class="btn btn-primary">
            ➕ Create Group
          </button>
          <button onclick="window.budgetApp?.openMerchantEditDialog()" class="btn btn-secondary" style="padding: 0.5rem 1rem;">
            ✏️ Edit Groups
          </button>
          <button onclick="window.budgetApp?.showSmartGroupingDialog()" class="btn btn-secondary" style="padding: 0.5rem 1rem;">
            🤖 Smart Group
          </button>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
        <!-- Ungrouped Merchants -->
        <div>
          <h4 style="color: var(--text-primary); margin-bottom: 1rem;">
            📝 Ungrouped Merchants (${sortedMerchants.filter(m => !merchantToGroupMap[m.merchant]).length})
          </h4>
          <div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: var(--radius-sm);">
            ${sortedMerchants
              .filter(merchantData => !merchantToGroupMap[merchantData.merchant])
              .map(merchantData => `
                <div style="padding: 0.75rem; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <div style="font-weight: 500; color: var(--text-primary);">${merchantData.merchant}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">${merchantData.count} transactions</div>
                  </div>
                  <select onchange="window.budgetApp?.assignMerchantToGroup('${merchantData.merchant}', this.value)" 
                          style="padding: 0.25rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 0.75rem;">
                    <option value="">Select group...</option>
                    ${Object.keys(merchantGroups).map(group => 
                      `<option value="${group}">${group}</option>`
                    ).join('')}
                  </select>
                </div>
              `).join('')}
          </div>
        </div>

        <!-- Merchant Groups -->
        <div>
          <h4 style="color: var(--text-primary); margin-bottom: 1rem;">
            🏪 Merchant Groups (${Object.keys(merchantGroups).length})
          </h4>
          <div style="max-height: 400px; overflow-y: auto;">
            ${Object.entries(merchantGroups).map(([groupName, merchants]) => `
              <div style="margin-bottom: 1rem; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--card-bg);">
                <div style="padding: 1rem; border-bottom: 1px solid var(--border-light); background: var(--bg-secondary); display: flex; justify-content: space-between; align-items: center;">
                  <strong style="color: var(--text-primary);">${groupName}</strong>
                  <span style="color: var(--text-secondary); font-size: 0.75rem;">${merchants.length} merchants</span>
                </div>
                <div style="padding: 0.5rem;">
                  ${merchants.map(merchant => `
                    <div style="padding: 0.25rem 0.5rem; margin: 0.25rem 0; background: var(--bg-secondary); border-radius: var(--radius-sm); display: flex; justify-content: space-between; align-items: center; font-size: 0.875rem;">
                      <span>${merchant}</span>
                      <button onclick="window.budgetApp?.removeMerchantFromGroup('${merchant}', '${groupName}')" 
                              style="background: none; border: none; color: var(--error-color); cursor: pointer; font-size: 0.75rem;" 
                              title="Remove from group">✖️</button>
                    </div>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // Helper function to find which group a merchant belongs to
  getMerchantGroup(merchantName, merchantGroups) {
    for (const [groupName, merchants] of Object.entries(merchantGroups)) {
      if (merchants.includes(merchantName)) {
        return groupName;
      }
    }
    return null;
  }

  // Create new merchant group
  createMerchantGroup() {
    const input = document.getElementById('new-merchant-group');
    const groupName = input?.value?.trim();
    
    if (!groupName) {
      UI.showToast('Please enter a group name', 'error');
      return;
    }

    const merchantGroups = this.categoryManager.getMerchantGroups();
    if (merchantGroups[groupName]) {
      UI.showToast('Group already exists', 'error');
      return;
    }

    merchantGroups[groupName] = [];
    this.categoryManager.saveMerchantGroups(merchantGroups);
    input.value = '';
    
    UI.showToast(`Created group: ${groupName}`, 'success');
    this.renderMerchantStepContent();
  }

  // Assign merchant to group
  async assignMerchantToGroup(merchantName, groupName) {
    if (!groupName) return;
    
    try {
      UI.showLoading('Updating merchant group...');
      
      // Update all rows with this merchant to have the new merchant group
      const credentials = Storage.getCredentials();
      const sheetId = credentials.sheetId;
      const merchantGroupColLetter = this.sheetsAPI.numberToLetter(this.columnIndices.merchantGroup + 1);
      
      const updatePromises = [];
      
      // Find all rows with this merchant and update their merchant group
      for (let i = 1; i < this.rowsData.length; i++) {
        const row = this.rowsData[i];
        const rowMerchant = row[this.columnIndices.merchant] || row[2]; // fallback to index 2
        
        if (rowMerchant === merchantName) {
          const rowNumber = i + 1; // +1 because sheets are 1-indexed
          const range = `${merchantGroupColLetter}${rowNumber}`;
          
          updatePromises.push(
            this.sheetsAPI.updateCell(sheetId, range, groupName)
          );
        }
      }
      
      await Promise.all(updatePromises);
      
      UI.hideLoading();
      UI.showToast(`Added ${merchantName} to ${groupName}`, 'success');
      
      // Reload data to reflect changes
      await this.loadDataFromAppsScript();
      this.renderMerchantStepContent();
      
    } catch (error) {
      UI.hideLoading();
      UI.handleError(error, 'Failed to update merchant group');
    }
  }

  // Remove merchant from group (clear merchant group column)
  async removeMerchantFromGroup(merchantName, groupName) {
    try {
      UI.showLoading('Removing merchant from group...');
      
      // Clear merchant group for all rows with this merchant
      const credentials = Storage.getCredentials();
      const sheetId = credentials.sheetId;
      const merchantGroupColLetter = this.sheetsAPI.numberToLetter(this.columnIndices.merchantGroup + 1);
      
      const updatePromises = [];
      
      // Find all rows with this merchant and clear their merchant group
      for (let i = 1; i < this.rowsData.length; i++) {
        const row = this.rowsData[i];
        const rowMerchant = row[this.columnIndices.merchant] || row[2];
        
        if (rowMerchant === merchantName) {
          const rowNumber = i + 1;
          const range = `${merchantGroupColLetter}${rowNumber}`;
          
          updatePromises.push(
            this.sheetsAPI.updateCell(sheetId, range, '')
          );
        }
      }
      
      await Promise.all(updatePromises);
      
      UI.hideLoading();
      UI.showToast(`Removed ${merchantName} from ${groupName}`, 'success');
      
      // Reload data to reflect changes
      await this.loadDataFromAppsScript();
      this.renderMerchantStepContent();
      
    } catch (error) {
      UI.hideLoading();
      UI.handleError(error, 'Failed to remove merchant from group');
    }
  }

  // Open merchant edit dialog
  openMerchantEditDialog() {
    // Enable caching for super responsive editing
    this.enableMerchantEditingCache();
    
    // Create modal backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'merchant-edit-modal';
    backdrop.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
      background: rgba(0,0,0,0.5); display: flex; align-items: center; 
      justify-content: center; z-index: 1000;
    `;
    
    // Get current merchant groups from live data (includes cached changes)
    const merchantGroups = this.getLiveMerchantData();

    // Analyze ungrouped merchants for smart grouping suggestions
    const allMerchants = new Set();
    const groupedMerchants = new Set();
    
    for (let i = 1; i < this.rowsData.length; i++) {
      const row = this.rowsData[i];
      const merchant = this.getColumnValue(row, 'merchant') || row[2] || 'Unknown';
      const merchantGroup = this.getColumnValue(row, 'merchantGroup');
      
      allMerchants.add(merchant);
      if (merchantGroup && merchantGroup.trim()) {
        groupedMerchants.add(merchant);
      }
    }
    
    const ungroupedMerchants = Array.from(allMerchants).filter(m => !groupedMerchants.has(m));
    const suggestedGroups = ungroupedMerchants.length > 0 ? this.analyzeMerchantPatterns(
      ungroupedMerchants.reduce((acc, m) => { acc[m] = 1; return acc; }, {})
    ) : [];

    backdrop.innerHTML = `
      <div style="background: var(--card-bg); border-radius: var(--radius); padding: 1.5rem; max-width: 1200px; width: 95%; max-height: 85vh; overflow-y: auto; box-shadow: var(--shadow-lg);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border-light); padding-bottom: 1rem;">
          <h2 style="margin: 0; color: var(--text-primary);">🏪 Merchant Group Management</h2>
          <div style="display: flex; gap: 1rem; align-items: center;">
            <div id="cache-status" style="padding: 0.5rem 1rem; background: linear-gradient(135deg, #10b981, #059669); color: white; border-radius: var(--radius-sm); font-size: 0.75rem; animation: pulse 2s infinite;">
              🚀 CACHED MODE - Super Fast!
            </div>
            <button onclick="window.budgetApp?.acceptMerchantChanges()" 
                    class="btn btn-success" style="padding: 0.5rem 1rem; font-size: 0.875rem; animation: glow 2s ease-in-out infinite alternate;">
              ✅ Accept Changes
            </button>
            <button onclick="window.budgetApp?.cancelMerchantChanges()" 
                    style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-secondary); transition: transform 0.2s; hover: transform: scale(1.1);">✖️</button>
          </div>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 320px; gap: 2rem; height: calc(85vh - 120px);">
          <!-- Left Column: Working Area -->
          <div style="overflow-y: auto;">
            <h3 style="color: var(--text-primary); margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
              <span>⚙️ Working Area</span>
              <span style="font-size: 0.75rem; color: var(--text-secondary); font-weight: normal;">${ungroupedMerchants.length} ungrouped merchants</span>
            </h3>
            
            <!-- Search and Add Section -->
            <div style="margin-bottom: 2rem; padding: 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-secondary);">
              <h4 style="color: var(--text-primary); margin-bottom: 1rem;">🔍 Search & Add Merchants to Groups</h4>
              <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
                <input type="text" id="merchant-search" placeholder="Search for merchants..." 
                       style="flex: 1; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm);"
                       oninput="window.budgetApp?.searchMerchants(this.value)">
                <select id="target-group-select" style="min-width: 200px; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                  <option value="">Select target group...</option>
                  ${Object.keys(merchantGroups).map(group => `<option value="${group}">${group}</option>`).join('')}
                </select>
                <button onclick="window.budgetApp?.addSelectedMerchantsToGroup()" class="btn btn-primary" style="padding: 0.5rem 1rem;">
                  ➕ Add Selected
                </button>
              </div>
              <div id="merchant-search-results" style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--card-bg);">
                <!-- Search results will appear here -->
              </div>
            </div>
            
            <!-- Currently Editing Group -->
            <div id="editing-group-container" style="display: none; margin-bottom: 2rem;"></div>
            
            ${ungroupedMerchants.length === 0 ? `
              <div style="text-align: center; padding: 3rem; color: var(--text-secondary); border: 2px dashed var(--border-light); border-radius: var(--radius-sm);">
                <div style="font-size: 2rem; margin-bottom: 1rem;">🎉</div>
                <h4 style="color: var(--success-color); margin-bottom: 0.5rem;">All Merchants Grouped!</h4>
                <p>Every merchant has been assigned to a group. Great work!</p>
              </div>
            ` : `
              <!-- Smart Suggestions -->
              ${suggestedGroups.length > 0 ? `
                <div style="margin-bottom: 2rem;">
                  <h4 style="color: var(--warning-color); margin-bottom: 1rem;">🤖 Smart Grouping Suggestions</h4>
                  ${suggestedGroups.map((group, index) => `
                    <div class="suggested-group" data-group-index="${index}" style="border: 2px solid var(--warning-color); border-radius: var(--radius-sm); padding: 1rem; margin-bottom: 1rem; background: linear-gradient(135deg, var(--card-bg) 0%, #fef3c7 100%);">
                      <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
                        <input type="text" class="suggested-group-name" value="${group.groupName}" 
                               style="flex: 1; padding: 0.5rem; border: 1px solid var(--warning-color); border-radius: var(--radius-sm); background: var(--card-bg); font-weight: 500;">
                        <button onclick="window.budgetApp?.confirmSuggestedGroup(${index})" 
                                class="confirm-suggestion-btn" 
                                style="padding: 0.5rem 1rem; border: none; background: var(--warning-color); color: white; border-radius: var(--radius-sm); cursor: pointer; font-weight: 500;">
                          ✅ Confirm Group
                        </button>
                      </div>
                      <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                        ${group.merchants.map(merchant => `
                          <div style="padding: 0.25rem 0.5rem; background: #fcd34d; color: #92400e; border-radius: var(--radius-sm); font-size: 0.875rem;">
                            ${merchant.name} (${merchant.count})
                          </div>
                        `).join('')}
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
              
              <!-- Individual Ungrouped Merchants -->
              ${ungroupedMerchants.length > suggestedGroups.reduce((sum, g) => sum + g.merchants.length, 0) ? `
                <div>
                  <h4 style="color: var(--text-secondary); margin-bottom: 1rem;">📝 Individual Merchants</h4>
                  <div style="display: grid; gap: 0.5rem;">
                    ${ungroupedMerchants.filter(merchant => 
                      !suggestedGroups.some(group => group.merchants.some(m => m.name === merchant))
                    ).map(merchant => `
                      <div style="display: flex; align-items: center; gap: 1rem; padding: 0.75rem; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--card-bg);">
                        <span style="flex: 1; font-weight: 500;">${merchant}</span>
                        <select onchange="window.budgetApp?.assignMerchantToExistingGroup('${merchant}', this.value)" 
                                style="padding: 0.25rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                          <option value="">Add to group...</option>
                          ${Object.keys(merchantGroups).map(group => 
                            `<option value="${group}">${group}</option>`
                          ).join('')}
                        </select>
                        <input type="text" placeholder="New group name" 
                               style="width: 150px; padding: 0.25rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm);"
                               onkeypress="if(event.key==='Enter') window.budgetApp?.createNewGroupWithMerchant('${merchant}', this.value)">
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            `}
          </div>
          
          <!-- Right Column: Confirmed Groups -->
          <div style="border-left: 1px solid var(--border-light); padding-left: 1.5rem; overflow-y: auto;">
            <h3 style="color: var(--success-color); margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
              <span>✅ Confirmed Groups</span>
              <span id="confirmed-groups-count" style="font-size: 0.75rem; color: var(--text-secondary); font-weight: normal;">${Object.keys(merchantGroups).length}</span>
            </h3>
            
            <div id="confirmed-groups-container" style="display: grid; gap: 0.75rem;">
              ${Object.entries(merchantGroups).map(([groupName, merchants]) => `
                <div class="confirmed-group" data-group-name="${groupName}" style="border: 1px solid var(--success-color); border-radius: var(--radius-sm); padding: 0.75rem; background: linear-gradient(135deg, var(--card-bg) 0%, #dcfce7 100%);">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                    <span style="font-weight: 600; color: var(--success-color); font-size: 0.875rem;">${groupName}</span>
                    <span style="color: var(--text-secondary); font-size: 0.75rem;">${merchants.length}</span>
                  </div>
                  <div style="display: flex; flex-wrap: wrap; gap: 0.25rem; margin-bottom: 0.5rem;">
                    ${merchants.slice(0, 3).map(merchant => `
                      <div style="padding: 0.125rem 0.25rem; background: var(--success-color); color: white; border-radius: 3px; font-size: 0.625rem;">
                        ${merchant.length > 12 ? merchant.substring(0, 12) + '...' : merchant}
                      </div>
                    `).join('')}
                    ${merchants.length > 3 ? `<div style="color: var(--text-secondary); font-size: 0.625rem;">+${merchants.length - 3} more</div>` : ''}
                  </div>
                  <div style="display: flex; gap: 0.25rem;">
                    <button onclick="window.budgetApp?.editConfirmedGroup('${groupName}')" 
                            style="flex: 1; padding: 0.25rem; border: 1px solid var(--success-color); background: transparent; color: var(--success-color); border-radius: var(--radius-sm); cursor: pointer; font-size: 0.75rem;">
                      ✏️ Edit
                    </button>
                    <button onclick="window.budgetApp?.deleteGroupInDialog('${groupName}')" 
                            style="padding: 0.25rem 0.5rem; border: 1px solid var(--error-color); background: var(--error-color); color: white; border-radius: var(--radius-sm); cursor: pointer; font-size: 0.75rem;">
                      🗑️
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        
        <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-light); text-align: center;">
          <button onclick="document.getElementById('merchant-edit-modal').remove(); window.budgetApp?.renderMerchantStepContent();" 
                  class="btn btn-primary">✅ Done Managing Groups</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(backdrop);
  }

  // Confirm a suggested group from smart grouping
  async confirmSuggestedGroup(groupIndex) {
    const modal = document.getElementById('merchant-edit-modal');
    if (!modal) return;
    
    const suggestedGroup = modal.querySelector(`.suggested-group[data-group-index="${groupIndex}"]`);
    const groupNameInput = suggestedGroup.querySelector('.suggested-group-name');
    const groupName = groupNameInput.value.trim();
    
    if (!groupName) {
      UI.showToast('Please enter a valid group name', 'error');
      return;
    }
    
    // Enable caching if not already enabled
    if (!this.merchantEditingCache.enabled) {
      this.enableMerchantEditingCache();
    }
    
    // Get merchants from this suggested group
    const merchantElements = suggestedGroup.querySelectorAll('[style*="background: #fcd34d"]');
    const merchants = Array.from(merchantElements).map(el => el.textContent.split(' (')[0].trim());
    
    // Apply changes using caching system for instant UI updates
    merchants.forEach(merchantName => {
      this.applyCachedMerchantChange(merchantName, groupName);
    });
    
    // Update UI instantly without waiting for Google Sheets
    UI.showToast(`Created group "${groupName}" with ${merchants.length} merchants`, 'success');
    
    // Move the group to confirmed side with animation
    this.moveGroupToConfirmed(suggestedGroup, groupName, merchants);
  }

  // Move a group to the confirmed side with animation
  moveGroupToConfirmed(sourceElement, groupName, merchants) {
    const modal = document.getElementById('merchant-edit-modal');
    const confirmedContainer = modal.querySelector('#confirmed-groups-container');
    
    // Create the confirmed group element
    const confirmedGroup = document.createElement('div');
    confirmedGroup.className = 'confirmed-group';
    confirmedGroup.dataset.groupName = groupName;
    confirmedGroup.style.cssText = 'border: 2px solid var(--success-color); border-radius: var(--radius-sm); padding: 0.75rem; background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); transform: scale(1.05); transition: all 0.3s ease; opacity: 0;';
    
    confirmedGroup.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
        <span style="font-weight: 600; color: var(--success-color); font-size: 0.875rem;">${groupName}</span>
        <span style="color: var(--text-secondary); font-size: 0.75rem;">${merchants.length}</span>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 0.25rem; margin-bottom: 0.5rem;">
        ${merchants.slice(0, 3).map(merchant => `
          <div style="padding: 0.125rem 0.25rem; background: var(--success-color); color: white; border-radius: 3px; font-size: 0.625rem;">
            ${merchant.length > 12 ? merchant.substring(0, 12) + '...' : merchant}
          </div>
        `).join('')}
        ${merchants.length > 3 ? `<div style="color: var(--text-secondary); font-size: 0.625rem;">+${merchants.length - 3} more</div>` : ''}
      </div>
      <div style="display: flex; gap: 0.25rem;">
        <button onclick="window.budgetApp?.editConfirmedGroup('${groupName}')" 
                style="flex: 1; padding: 0.25rem; border: 1px solid var(--success-color); background: transparent; color: var(--success-color); border-radius: var(--radius-sm); cursor: pointer; font-size: 0.75rem;">
          ✏️ Edit
        </button>
        <button onclick="window.budgetApp?.deleteGroupInDialog('${groupName}')" 
                style="padding: 0.25rem 0.5rem; border: 1px solid var(--error-color); background: var(--error-color); color: white; border-radius: var(--radius-sm); cursor: pointer; font-size: 0.75rem;">
          🗑️
        </button>
      </div>
    `;
    
    // Add to confirmed container
    confirmedContainer.appendChild(confirmedGroup);
    
    // Update confirmed groups count
    this.updateConfirmedGroupsCount();
    
    // Update target group dropdown with new group
    this.updateTargetGroupDropdown(groupName);
    
    // Animate the source element disappearing
    sourceElement.style.transform = 'scale(0.95)';
    sourceElement.style.opacity = '0.5';
    
    setTimeout(() => {
      sourceElement.remove();
      // Animate the confirmed group appearing
      confirmedGroup.style.opacity = '1';
      setTimeout(() => {
        confirmedGroup.style.transform = 'scale(1)';
        confirmedGroup.style.border = '1px solid var(--success-color)';
        confirmedGroup.style.background = 'linear-gradient(135deg, var(--card-bg) 0%, #dcfce7 100%)';
      }, 100);
    }, 300);
  }

  // Assign merchant to existing group
  async assignMerchantToExistingGroup(merchantName, groupName) {
    if (!groupName) return;
    
    // Enable caching if not already enabled
    if (!this.merchantEditingCache.enabled) {
      this.enableMerchantEditingCache();
    }
    
    // Apply change using caching system for instant UI update
    this.applyCachedMerchantChange(merchantName, groupName);
    
    // Update UI instantly without waiting for Google Sheets
    UI.showToast(`Added ${merchantName} to ${groupName}`, 'success');
    
    // Refresh the dialog to show updated groupings
    this.openMerchantEditDialog();
  }

  // Create new group with merchant
  async createNewGroupWithMerchant(merchantName, groupName) {
    if (!groupName || !groupName.trim()) {
      UI.showToast('Please enter a group name', 'error');
      return;
    }
    
    // Enable caching if not already enabled
    if (!this.merchantEditingCache.enabled) {
      this.enableMerchantEditingCache();
    }
    
    // Apply change using caching system for instant UI update
    this.applyCachedMerchantChange(merchantName, groupName.trim());
    
    // Update UI instantly without waiting for Google Sheets
    UI.showToast(`Created new group "${groupName.trim()}" with ${merchantName}`, 'success');
    
    // Refresh the dialog to show updated groupings
    this.openMerchantEditDialog();
  }

  // Edit a confirmed group - move it back to working area
  editConfirmedGroup(groupName) {
    const modal = document.getElementById('merchant-edit-modal');
    if (!modal) return;
    
    // Get merchants in this group
    const groupMerchants = [];
    for (let i = 1; i < this.rowsData.length; i++) {
      const row = this.rowsData[i];
      const merchant = this.getColumnValue(row, 'merchant') || row[2] || 'Unknown';
      const merchantGroup = this.getColumnValue(row, 'merchantGroup');
      
      if (merchantGroup && merchantGroup.trim() === groupName && !groupMerchants.includes(merchant)) {
        groupMerchants.push(merchant);
      }
    }
    
    // Remove from confirmed groups
    const confirmedGroup = modal.querySelector(`[data-group-name="${groupName}"]`);
    if (confirmedGroup) {
      confirmedGroup.remove();
      // Update count after removal
      this.updateConfirmedGroupsCount();
      // Refresh dropdown to remove the group
      this.refreshTargetGroupDropdown();
    }
    
    // Show in editing area
    const editingContainer = modal.querySelector('#editing-group-container');
    editingContainer.style.display = 'block';
    editingContainer.innerHTML = `
      <div style="border: 2px solid var(--primary-color); border-radius: var(--radius-sm); padding: 1rem; background: linear-gradient(135deg, var(--card-bg) 0%, #e0e7ff 100%);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h4 style="color: var(--primary-color); margin: 0;">✏️ Editing: ${groupName}</h4>
          <div style="display: flex; gap: 0.5rem;">
            <button onclick="window.budgetApp?.saveEditingGroup()" class="btn btn-primary" style="padding: 0.25rem 0.75rem; font-size: 0.875rem;">
              💾 Save Changes
            </button>
            <button onclick="window.budgetApp?.cancelEditingGroup('${groupName}')" class="btn btn-secondary" style="padding: 0.25rem 0.75rem; font-size: 0.875rem;">
              ❌ Cancel
            </button>
          </div>
        </div>
        
        <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
          <label style="color: var(--text-secondary); font-weight: 500;">Group Name:</label>
          <input type="text" id="editing-group-name" value="${groupName}" 
                 style="flex: 1; padding: 0.5rem; border: 1px solid var(--primary-color); border-radius: var(--radius-sm); font-weight: 500;">
        </div>
        
        <div style="margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <span style="color: var(--text-secondary); font-weight: 500;">Merchants in this group:</span>
            <span style="color: var(--text-secondary); font-size: 0.875rem;">${groupMerchants.length} merchants</span>
          </div>
          <div id="editing-group-merchants" style="display: flex; flex-wrap: wrap; gap: 0.5rem; min-height: 50px; padding: 0.75rem; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--card-bg);">
            ${groupMerchants.map(merchant => `
              <div class="editing-merchant" data-merchant="${merchant}" style="display: flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.5rem; background: var(--primary-color); color: white; border-radius: var(--radius-sm); font-size: 0.875rem;">
                <span>${merchant}</span>
                <button onclick="window.budgetApp?.removeMerchantFromEditing('${merchant}')" 
                        style="background: none; border: none; color: white; cursor: pointer; font-size: 0.75rem; opacity: 0.8;" 
                        title="Remove from group">✖️</button>
              </div>
            `).join('')}
          </div>
        </div>
        
        <div style="padding: 0.75rem; background: var(--bg-secondary); border-radius: var(--radius-sm);">
          <div style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 0.5rem;">
            💡 Use the search box above to find and add more merchants to this group
          </div>
        </div>
      </div>
    `;
    
    // Pre-populate the target group selector
    const targetSelect = modal.querySelector('#target-group-select');
    if (targetSelect) {
      targetSelect.value = groupName;
    }
    
    UI.showToast(`Now editing "${groupName}" - use search to add more merchants`, 'info');
  }

  // Search for merchants
  searchMerchants(searchTerm) {
    const modal = document.getElementById('merchant-edit-modal');
    const resultsContainer = modal.querySelector('#merchant-search-results');
    
    if (!searchTerm || searchTerm.length < 1) {
      resultsContainer.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-secondary);">Start typing to search merchants...</div>';
      return;
    }
    
    // Get all merchants and their current group status
    const allMerchants = new Map(); // merchant -> { group, count }
    
    for (let i = 1; i < this.rowsData.length; i++) {
      const row = this.rowsData[i];
      const merchant = this.getColumnValue(row, 'merchant') || row[2] || 'Unknown';
      const merchantGroup = this.getColumnValue(row, 'merchantGroup');
      
      if (!allMerchants.has(merchant)) {
        allMerchants.set(merchant, { group: merchantGroup || null, count: 0 });
      }
      allMerchants.get(merchant).count++;
    }
    
    // Filter merchants by search term
    const searchLower = searchTerm.toLowerCase();
    const matchingMerchants = Array.from(allMerchants.entries())
      .filter(([merchant]) => merchant.toLowerCase().includes(searchLower))
      .sort(([a], [b]) => a.localeCompare(b));
    
    if (matchingMerchants.length === 0) {
      resultsContainer.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-secondary);">No merchants found matching your search.</div>';
      return;
    }
    
    resultsContainer.innerHTML = `
      <div style="padding: 0.5rem; border-bottom: 1px solid var(--border-light); background: var(--bg-secondary); font-size: 0.875rem; color: var(--text-secondary);">
        Found ${matchingMerchants.length} merchants
        <button onclick="window.budgetApp?.selectAllSearchResults()" style="float: right; background: none; border: none; color: var(--primary-color); cursor: pointer; font-size: 0.75rem;">Select All</button>
      </div>
      ${matchingMerchants.map(([merchant, info]) => `
        <div style="display: flex; align-items: center; gap: 1rem; padding: 0.75rem; border-bottom: 1px solid var(--border-light); hover:background: var(--bg-secondary);">
          <input type="checkbox" class="merchant-search-checkbox" data-merchant="${merchant}" style="transform: scale(1.2);">
          <div style="flex: 1;">
            <div style="font-weight: 500; color: var(--text-primary);">${merchant}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">
              ${info.count} transactions • 
              ${info.group ? `Currently in: ${info.group}` : 'Not grouped'}
            </div>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">
            ${info.group ? `📁 ${info.group}` : '❌ Ungrouped'}
          </div>
        </div>
      `).join('')}
    `;
  }

  // Select all search results
  selectAllSearchResults() {
    const modal = document.getElementById('merchant-edit-modal');
    const checkboxes = modal.querySelectorAll('.merchant-search-checkbox');
    checkboxes.forEach(checkbox => checkbox.checked = true);
  }

  // Add selected merchants to group
  async addSelectedMerchantsToGroup() {
    const modal = document.getElementById('merchant-edit-modal');
    const targetSelect = modal.querySelector('#target-group-select');
    const checkboxes = modal.querySelectorAll('.merchant-search-checkbox:checked');
    
    const targetGroup = targetSelect.value;
    if (!targetGroup) {
      UI.showToast('Please select a target group first', 'error');
      return;
    }
    
    const selectedMerchants = Array.from(checkboxes).map(cb => cb.dataset.merchant);
    if (selectedMerchants.length === 0) {
      UI.showToast('Please select at least one merchant', 'error');
      return;
    }
    
    // Enable caching if not already enabled
    if (!this.merchantEditingCache.enabled) {
      this.enableMerchantEditingCache();
    }
    
    // Apply changes using caching system for instant UI updates
    selectedMerchants.forEach(merchantName => {
      this.applyCachedMerchantChange(merchantName, targetGroup);
    });
    
    // Update UI instantly without waiting for Google Sheets
    UI.showToast(`Added ${selectedMerchants.length} merchants to "${targetGroup}"`, 'success');
    
    // If we're editing a group, add to the editing area
    const editingContainer = modal.querySelector('#editing-group-container');
    if (editingContainer.style.display !== 'none' && targetGroup === modal.querySelector('#editing-group-name')?.value) {
      this.addMerchantsToEditingArea(selectedMerchants);
    }
    
    // Clear search and refresh
    modal.querySelector('#merchant-search').value = '';
    this.searchMerchants('');
  }

  // Add merchants to editing area
  addMerchantsToEditingArea(merchants) {
    const modal = document.getElementById('merchant-edit-modal');
    const editingMerchants = modal.querySelector('#editing-group-merchants');
    
    merchants.forEach(merchant => {
      // Check if merchant is already in the editing area
      if (!editingMerchants.querySelector(`[data-merchant="${merchant}"]`)) {
        const merchantElement = document.createElement('div');
        merchantElement.className = 'editing-merchant';
        merchantElement.dataset.merchant = merchant;
        merchantElement.style.cssText = 'display: flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.5rem; background: var(--primary-color); color: white; border-radius: var(--radius-sm); font-size: 0.875rem;';
        
        merchantElement.innerHTML = `
          <span>${merchant}</span>
          <button onclick="window.budgetApp?.removeMerchantFromEditing('${merchant}')" 
                  style="background: none; border: none; color: white; cursor: pointer; font-size: 0.75rem; opacity: 0.8;" 
                  title="Remove from group">✖️</button>
        `;
        
        editingMerchants.appendChild(merchantElement);
      }
    });
  }

  // Remove merchant from editing area
  removeMerchantFromEditing(merchant) {
    const modal = document.getElementById('merchant-edit-modal');
    const merchantElement = modal.querySelector(`[data-merchant="${merchant}"]`);
    if (merchantElement) {
      merchantElement.remove();
    }
  }

  // Save editing group
  async saveEditingGroup() {
    const modal = document.getElementById('merchant-edit-modal');
    const editingContainer = modal.querySelector('#editing-group-container');
    const groupNameInput = modal.querySelector('#editing-group-name');
    const editingMerchants = modal.querySelectorAll('.editing-merchant');
    
    const newGroupName = groupNameInput.value.trim();
    if (!newGroupName) {
      UI.showToast('Please enter a valid group name', 'error');
      return;
    }
    
    // Enable caching if not already enabled
    if (!this.merchantEditingCache.enabled) {
      this.enableMerchantEditingCache();
    }
    
    const merchants = Array.from(editingMerchants).map(el => el.dataset.merchant);
    
    // Apply changes using caching system for instant UI updates
    merchants.forEach(merchantName => {
      this.applyCachedMerchantChange(merchantName, newGroupName);
    });
    
    // Update UI instantly without waiting for Google Sheets
    UI.showToast(`Saved "${newGroupName}" with ${merchants.length} merchants`, 'success');
    
    // Hide editing area and move to confirmed
    editingContainer.style.display = 'none';
    this.moveGroupToConfirmed(editingContainer, newGroupName, merchants);
  }

  // Cancel editing group
  cancelEditingGroup(originalGroupName) {
    const modal = document.getElementById('merchant-edit-modal');
    const editingContainer = modal.querySelector('#editing-group-container');
    
    // Hide editing area
    editingContainer.style.display = 'none';
    
    // Refresh the dialog to restore the group to confirmed side
    this.openMerchantEditDialog();
    
    UI.showToast(`Cancelled editing "${originalGroupName}"`, 'info');
  }

  // Update confirmed groups count in the header - FOOL-PROOF VERSION
  updateConfirmedGroupsCount() {
    const modal = document.getElementById('merchant-edit-modal');
    if (!modal) return;
    
    // Get REAL count from actual Google Sheets data, not DOM elements
    const actualConfirmedGroups = this.getActualConfirmedGroups();
    const countElement = modal.querySelector('#confirmed-groups-count');
    
    if (countElement) {
      countElement.textContent = `${actualConfirmedGroups.size}`;
    }
  }

  // Get actual confirmed groups from Google Sheets data - RELIABLE SOURCE
  getActualConfirmedGroups() {
    const confirmedGroups = new Set();
    
    // Read directly from the raw Google Sheets data
    for (let i = 1; i < this.rowsData.length; i++) {
      const row = this.rowsData[i];
      const merchantGroup = this.getColumnValue(row, 'merchantGroup');
      
      if (merchantGroup && merchantGroup.trim()) {
        confirmedGroups.add(merchantGroup.trim());
      }
    }
    
    return confirmedGroups;
  }

  // Update target group dropdown with new groups
  updateTargetGroupDropdown(newGroupName) {
    const modal = document.getElementById('merchant-edit-modal');
    if (!modal) return;
    
    const targetSelect = modal.querySelector('#target-group-select');
    if (!targetSelect) return;
    
    // Check if the group is already in the dropdown
    const existingOption = Array.from(targetSelect.options).find(option => option.value === newGroupName);
    if (existingOption) return;
    
    // Add the new group to the dropdown
    const option = document.createElement('option');
    option.value = newGroupName;
    option.textContent = newGroupName;
    targetSelect.appendChild(option);
    
    // Sort the options alphabetically (except for the first "Select..." option)
    const options = Array.from(targetSelect.options);
    const firstOption = options.shift(); // Remove the first "Select..." option
    
    options.sort((a, b) => a.textContent.localeCompare(b.textContent));
    
    // Clear and rebuild the select
    targetSelect.innerHTML = '';
    targetSelect.appendChild(firstOption);
    options.forEach(option => targetSelect.appendChild(option));
  }

  // Refresh target group dropdown with all current groups
  refreshTargetGroupDropdown() {
    const modal = document.getElementById('merchant-edit-modal');
    if (!modal) return;
    
    const targetSelect = modal.querySelector('#target-group-select');
    const confirmedGroups = modal.querySelectorAll('.confirmed-group');
    
    if (!targetSelect) return;
    
    // Get all current group names
    const groupNames = Array.from(confirmedGroups).map(group => group.dataset.groupName).sort();
    
    // Clear and rebuild the dropdown
    targetSelect.innerHTML = `
      <option value="">Select target group...</option>
      ${groupNames.map(name => `<option value="${name}">${name}</option>`).join('')}
    `;
  }

  // Check merchant grouping status after data load
  checkMerchantGroupingStatus() {
    // Calculate grouping statistics
    let totalMerchants = 0;
    let groupedMerchants = 0;
    const uniqueMerchants = new Set();
    
    for (let i = 1; i < this.rowsData.length; i++) {
      const row = this.rowsData[i];
      const merchant = this.getColumnValue(row, 'merchant') || row[2] || 'Unknown';
      const merchantGroup = this.getColumnValue(row, 'merchantGroup');
      
      uniqueMerchants.add(merchant);
      if (merchantGroup && merchantGroup.trim()) {
        groupedMerchants++;
      }
    }
    
    totalMerchants = uniqueMerchants.size;
    const groupingPercentage = totalMerchants > 0 ? (groupedMerchants / this.rowsData.length - 1) * 100 : 0;
    
    // Removed excessive console logging for cleaner production code
    
    // If less than 50% of transactions are grouped, auto-navigate to merchants
    if (groupingPercentage < 50) {
      setTimeout(() => {
        UI.showToast('⚠️ Most merchants need grouping. Redirecting to Merchant Management...', 'warning', 4000);
        setTimeout(() => {
          this.switchView('merchants');
        }, 1000);
      }, 2000);
    }
  }

  // Rename merchant group in edit dialog
  async renameGroupInDialog(oldGroupName, newGroupName, groupIndex) {
    
    if (!newGroupName || !newGroupName.trim()) {
      UI.showToast('Please enter a valid group name', 'error');
      return;
    }

    const trimmedNewName = newGroupName.trim();
    if (trimmedNewName === oldGroupName) {
      UI.showToast('Group name unchanged - saving group as confirmed', 'info');
      // Even if name unchanged, mark as confirmed and hide
      this.updateGroupAsConfirmed(groupIndex, trimmedNewName);
      return;
    }

    try {
      UI.showLoading('Saving merchant group...');
      
      const credentials = Storage.getCredentials();
      const sheetId = credentials.sheetId;
      const merchantGroupColLetter = this.sheetsAPI.numberToLetter(this.columnIndices.merchantGroup + 1);
      
      const updatePromises = [];
      
      // Find all rows with the old group name and update to new name
      for (let i = 1; i < this.rowsData.length; i++) {
        const row = this.rowsData[i];
        const merchantGroup = this.getColumnValue(row, 'merchantGroup');
        
        if (merchantGroup && merchantGroup.trim() === oldGroupName) {
          const rowNumber = i + 1;
          const range = `${merchantGroupColLetter}${rowNumber}`;
          
          updatePromises.push(
            this.sheetsAPI.updateCell(sheetId, range, trimmedNewName)
          );
        }
      }
      
      if (updatePromises.length === 0) {
        UI.hideLoading();
        UI.showToast('No merchants found in this group', 'warning');
        return;
      }
      
      await Promise.all(updatePromises);
      
      UI.hideLoading();
      UI.showToast(`Saved "${trimmedNewName}" group successfully`, 'success');
      
      // Update the UI immediately to show confirmation
      this.updateGroupAsConfirmed(groupIndex, trimmedNewName);
      
      // Reload data in background without closing modal
      await this.loadDataFromAppsScript();
      
    } catch (error) {
      UI.hideLoading();
      console.error('Error renaming group:', error);
      UI.handleError(error, 'Failed to save merchant group');
    }
  }

  // Delete entire merchant group in edit dialog
  async deleteGroupInDialog(groupName) {
    if (!confirm(`Are you sure you want to delete the entire "${groupName}" group?\n\nThis will remove the group assignment from all merchants in this group.`)) {
      return;
    }

    try {
      UI.showLoading('Deleting merchant group...');
      
      const credentials = Storage.getCredentials();
      const sheetId = credentials.sheetId;
      const merchantGroupColLetter = this.sheetsAPI.numberToLetter(this.columnIndices.merchantGroup + 1);
      
      const updatePromises = [];
      
      // Find all rows with this group name and clear the merchant group
      for (let i = 1; i < this.rowsData.length; i++) {
        const row = this.rowsData[i];
        const merchantGroup = this.getColumnValue(row, 'merchantGroup');
        
        if (merchantGroup && merchantGroup.trim() === groupName) {
          const rowNumber = i + 1;
          const range = `${merchantGroupColLetter}${rowNumber}`;
          
          updatePromises.push(
            this.sheetsAPI.updateCell(sheetId, range, '')
          );
        }
      }
      
      if (updatePromises.length === 0) {
        UI.hideLoading();
        UI.showToast('No merchants found in this group', 'warning');
        return;
      }
      
      await Promise.all(updatePromises);
      
      UI.hideLoading();
      UI.showToast(`Deleted group "${groupName}" and ungrouped ${updatePromises.length} merchants`, 'success');
      
      // Close modal and reload data
      document.getElementById('merchant-edit-modal').remove();
      await this.loadDataFromAppsScript();
      this.renderMerchantStepContent();
      
    } catch (error) {
      UI.hideLoading();
      UI.handleError(error, 'Failed to delete merchant group');
    }
  }

  // Update group appearance as confirmed in edit dialog
  updateGroupAsConfirmed(groupIndex) {
    
    const modal = document.getElementById('merchant-edit-modal');
    if (!modal) {
      console.error('Modal not found');
      return;
    }
    
    // Find all group containers more reliably
    const groupElements = modal.querySelectorAll('[style*="border: 1px solid var(--border-light)"]');
    
    const groupElement = groupElements[groupIndex];
    
    if (groupElement) {
      
      // Show confirmation animation then hide
      groupElement.style.cssText = 'border: 2px solid var(--success-color); border-radius: var(--radius-sm); padding: 1rem; background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); transform: scale(1.02); transition: all 0.3s ease; position: relative;';
      
      // Add a "SAVED" badge
      const savedBadge = document.createElement('div');
      savedBadge.innerHTML = '✅ SAVED';
      savedBadge.style.cssText = 'position: absolute; top: 0.5rem; right: 0.5rem; background: var(--success-color); color: white; padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; z-index: 10;';
      groupElement.appendChild(savedBadge);
      
      // Disable the input and save button
      const input = groupElement.querySelector(`input[type="text"]`);
      const saveButton = groupElement.querySelector('[title="Rename group"]');
      
      if (input) {
        input.disabled = true;
        input.style.color = 'var(--success-color)';
        input.style.fontWeight = '600';
      }
      
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.innerHTML = '✅';
        saveButton.style.background = 'var(--success-color)';
        saveButton.onclick = null;
      }
      
      // Fade out and hide after 2 seconds
      setTimeout(() => {
        groupElement.style.opacity = '0.5';
        groupElement.style.transform = 'scale(0.95)';
        
        setTimeout(() => {
          groupElement.style.display = 'none';
          
          // Check if all groups are hidden
          const allGroups = modal.querySelectorAll('[style*="border:"]');
          const visibleGroups = Array.from(allGroups).filter(el => el.style.display !== 'none');
          
          
          if (visibleGroups.length === 0) {
            const modalContent = modal.querySelector('[style*="max-width: 600px"]');
            if (modalContent) {
              modalContent.innerHTML = `
                <div style="text-align: center; padding: 3rem;">
                  <div style="font-size: 3rem; margin-bottom: 1rem;">🎉</div>
                  <h2 style="color: var(--success-color); margin-bottom: 1rem;">All Merchant Groups Confirmed!</h2>
                  <p style="color: var(--text-secondary); margin-bottom: 2rem;">
                    All your merchant groups have been saved to Google Sheets. You can now proceed to categorize your merchant groups.
                  </p>
                  <div style="display: flex; gap: 1rem; justify-content: center;">
                    <button onclick="document.getElementById('merchant-edit-modal').remove(); window.budgetApp?.renderMerchantStepContent();" 
                            class="btn btn-secondary">Done Editing</button>
                    <button onclick="document.getElementById('merchant-edit-modal').remove(); window.budgetApp?.setMerchantStep(2);" 
                            class="btn btn-primary">→ Continue to Step 2</button>
                  </div>
                </div>
              `;
            }
          }
        }, 300);
      }, 1500);
    } else {
      console.error('Group element not found at index:', groupIndex);
    }
  }

  // Check if merchant grouping is sufficient for other features
  canAccessAdvancedFeatures() {
    let groupedTransactions = 0;
    let totalTransactions = this.rowsData.length - 1; // Subtract header row
    
    for (let i = 1; i < this.rowsData.length; i++) {
      const row = this.rowsData[i];
      const merchantGroup = this.getColumnValue(row, 'merchantGroup');
      if (merchantGroup && merchantGroup.trim()) {
        groupedTransactions++;
      }
    }
    
    const groupingPercentage = totalTransactions > 0 ? (groupedTransactions / totalTransactions) * 100 : 0;
    return groupingPercentage >= 70; // Require 70% grouping for advanced features
  }

  // Step 2: Categorize merchant groups
  renderCategorizeGroupsStep(container, transactions) {
    // Check if merchant grouping is sufficient
    if (!this.canAccessAdvancedFeatures()) {
      container.innerHTML = `
        <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
          <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
          <h3 style="color: var(--text-primary); margin-bottom: 1rem;">Complete Merchant Grouping First</h3>
          <p style="margin-bottom: 1.5rem;">You need to group at least 70% of your transactions before proceeding to Step 2.</p>
          <button onclick="window.budgetApp?.setMerchantStep(1)" class="btn btn-primary">
            ← Return to Step 1: Merchant Groups
          </button>
        </div>
      `;
      return;
    }

    // Get merchant groups from Google Sheets data
    const merchantToGroupMap = {};
    const merchantGroupCategories = {};
    
    // Read merchant groups and categories directly from the raw data
    for (let i = 1; i < this.rowsData.length; i++) {
      const row = this.rowsData[i];
      const merchant = this.getColumnValue(row, 'merchant') || row[2] || 'Unknown';
      const merchantGroup = this.getColumnValue(row, 'merchantGroup');
      const category = this.getColumnValue(row, 'category') || 'Uncategorized';
      
      if (merchantGroup && merchantGroup.trim()) {
        merchantToGroupMap[merchant] = merchantGroup.trim();
        // Track what category this merchant group is most often assigned to
        if (!merchantGroupCategories[merchantGroup.trim()]) {
          merchantGroupCategories[merchantGroup.trim()] = {};
        }
        merchantGroupCategories[merchantGroup.trim()][category] = (merchantGroupCategories[merchantGroup.trim()][category] || 0) + 1;
      }
    }

    // Build unique merchant groups
    const merchantGroups = [...new Set(Object.values(merchantToGroupMap))];

    // Get most common category for each merchant group
    const groupSuggestedCategories = {};
    Object.entries(merchantGroupCategories).forEach(([group, categories]) => {
      const sortedCategories = Object.entries(categories).sort(([,a], [,b]) => b - a);
      groupSuggestedCategories[group] = sortedCategories[0] ? sortedCategories[0][0] : 'Uncategorized';
    });

    // Get available categories
    const allCategories = [...new Set(transactions.map(t => t[7] || 'Uncategorized'))];

    container.innerHTML = `
      <div style="margin-bottom: 2rem;">
        <h3 style="color: var(--text-primary); margin-bottom: 0.5rem;">Step 2: Assign Merchant Groups to Categories</h3>
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
          Assign each merchant group to a spending category. This will automatically categorize all future transactions from these merchants.
        </p>
      </div>

      <div style="display: grid; gap: 1rem;">
        ${merchantGroups.map(groupName => {
          const merchantsInGroup = Object.entries(merchantToGroupMap).filter(([, group]) => group === groupName).map(([merchant]) => merchant);
          const suggestedCategory = groupSuggestedCategories[groupName] || 'Uncategorized';
          
          return `
            <div style="border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 1.5rem; background: var(--card-bg);">
              <div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 1rem; align-items: center;">
                <div>
                  <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.25rem;">${groupName}</div>
                  <div style="font-size: 0.75rem; color: var(--text-secondary);">${merchantsInGroup.length} merchants</div>
                  <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">
                    ${merchantsInGroup.slice(0, 3).join(', ')}${merchantsInGroup.length > 3 ? '...' : ''}
                  </div>
                </div>
                
                <div style="text-align: center;">
                  <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Current: ${suggestedCategory}</div>
                  <select onchange="window.budgetApp?.assignGroupToCategory('${groupName}', this.value)" 
                          style="padding: 0.5rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); width: 100%;">
                    <option value="">Select category...</option>
                    ${allCategories.map(category => 
                      `<option value="${category}" ${category === suggestedCategory ? 'selected' : ''}>${category}</option>`
                    ).join('')}
                  </select>
                </div>
                
                <div>
                  <button onclick="window.budgetApp?.viewGroupMerchants('${groupName}')" 
                          style="padding: 0.5rem 1rem; border: 1px solid var(--border-color); background: var(--card-bg); border-radius: var(--radius-sm); cursor: pointer; font-size: 0.75rem;"
                          title="View merchants">👁️ View</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Step 3: Organize categories into groups
  renderCategoryGroupsStep(container, transactions) {
    // Check if merchant grouping is sufficient
    if (!this.canAccessAdvancedFeatures()) {
      container.innerHTML = `
        <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
          <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
          <h3 style="color: var(--text-primary); margin-bottom: 1rem;">Complete Previous Steps First</h3>
          <p style="margin-bottom: 1.5rem;">You need to complete merchant grouping (Step 1) and categorization (Step 2) before proceeding to Step 3.</p>
          <button onclick="window.budgetApp?.setMerchantStep(1)" class="btn btn-primary">
            ← Return to Step 1: Merchant Groups
          </button>
        </div>
      `;
      return;
    }

    // Get all categories and their current groups
    const allCategories = [...new Set(transactions.map(t => t[7] || 'Uncategorized'))];
    const categoryGroups = {
      'Living Expenses': [],
      'Lifestyle': [],
      'Financial': [],
      'Personal': []
    };

    // Organize categories by their current groups
    allCategories.forEach(category => {
      const group = this.categoryManager.findCategoryGroup(category) || 'Personal';
      if (categoryGroups[group]) {
        categoryGroups[group].push(category);
      }
    });

    container.innerHTML = `
      <div style="margin-bottom: 2rem;">
        <h3 style="color: var(--text-primary); margin-bottom: 0.5rem;">Step 3: Organize Categories into Groups</h3>
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
          Organize your spending categories into logical groups: Living Expenses, Lifestyle, Financial, and Personal.
        </p>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem;">
        ${Object.entries(categoryGroups).map(([groupName, categories]) => `
          <div style="border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 1rem; background: var(--card-bg);">
            <div style="border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; margin-bottom: 1rem;">
              <h4 style="margin: 0; color: var(--text-primary);">${groupName}</h4>
              <div style="font-size: 0.75rem; color: var(--text-secondary);">${categories.length} categories</div>
            </div>
            
            <div style="min-height: 200px;">
              ${categories.map(category => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; margin: 0.25rem 0; background: var(--bg-secondary); border-radius: var(--radius-sm);">
                  <span style="font-size: 0.875rem; color: var(--text-primary);">${category}</span>
                  <select onchange="window.budgetApp?.categoryManager?.moveCategory('${category}', this.value)" 
                          style="padding: 0.25rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 0.75rem;">
                    <option value="${groupName}">Stay here</option>
                    ${Object.keys(categoryGroups).filter(g => g !== groupName).map(g => 
                      `<option value="${g}">Move to ${g}</option>`
                    ).join('')}
                  </select>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
      
      <div style="margin-top: 2rem; padding: 1rem; background: var(--bg-secondary); border-radius: var(--radius-sm);">
        <div style="display: flex; gap: 1rem; align-items: center;">
          <input type="text" id="new-category-name" placeholder="Add new category..." 
                 style="padding: 0.5rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); flex: 1;">
          <select id="new-category-group" style="padding: 0.5rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
            ${Object.keys(categoryGroups).map(group => 
              `<option value="${group}">${group}</option>`
            ).join('')}
          </select>
          <button onclick="window.budgetApp?.addNewCategory()" class="btn btn-primary">
            ➕ Add Category
          </button>
        </div>
      </div>
    `;
  }

  // Assign merchant group to category
  async assignGroupToCategory(groupName, categoryName) {
    if (!categoryName) return;
    
    try {
      UI.showLoading('Updating categories...');
      
      // Update all transactions with this merchant group to have the new category
      const credentials = Storage.getCredentials();
      const sheetId = credentials.sheetId;
      const categoryColLetter = this.sheetsAPI.numberToLetter(this.columnIndices.category + 1);
      
      const updatePromises = [];
      
      // Find all rows with this merchant group and update their category
      for (let i = 1; i < this.rowsData.length; i++) {
        const row = this.rowsData[i];
        const rowMerchantGroup = this.getColumnValue(row, 'merchantGroup');
        
        if (rowMerchantGroup === groupName) {
          const rowNumber = i + 1;
          const range = `${categoryColLetter}${rowNumber}`;
          
          updatePromises.push(
            this.sheetsAPI.updateCell(sheetId, range, categoryName)
          );
        }
      }
      
      await Promise.all(updatePromises);
      
      UI.hideLoading();
      UI.showToast(`Assigned ${groupName} to ${categoryName}`, 'success');
      
      // Reload data to reflect changes
      await this.loadDataFromAppsScript();
      this.renderMerchantStepContent();
      
    } catch (error) {
      UI.hideLoading();
      UI.handleError(error, 'Failed to assign group to category');
    }
  }

  // View merchants in a group
  viewGroupMerchants(groupName) {
    const merchants = [];
    
    // Read merchants directly from the raw data
    for (let i = 1; i < this.rowsData.length; i++) {
      const row = this.rowsData[i];
      const merchant = this.getColumnValue(row, 'merchant') || row[2] || 'Unknown';
      const merchantGroup = this.getColumnValue(row, 'merchantGroup');
      
      if (merchantGroup && merchantGroup.trim() === groupName && !merchants.includes(merchant)) {
        merchants.push(merchant);
      }
    }
    
    alert(`Merchants in "${groupName}":\n\n${merchants.join('\n')}`);
  }

  // Add new category
  addNewCategory() {
    const nameInput = document.getElementById('new-category-name');
    const groupSelect = document.getElementById('new-category-group');
    
    const categoryName = nameInput?.value?.trim();
    const groupName = groupSelect?.value;
    
    if (!categoryName) {
      UI.showToast('Please enter a category name', 'error');
      return;
    }
    
    if (!groupName) {
      UI.showToast('Please select a group', 'error');
      return;
    }

    const success = this.categoryManager.addCategory(categoryName, groupName);
    if (success) {
      nameInput.value = '';
      UI.showToast(`Added ${categoryName} to ${groupName}`, 'success');
      this.renderMerchantStepContent();
    } else {
      UI.showToast('Category already exists', 'error');
    }
  }

  // Smart merchant grouping feature
  showSmartGroupingDialog(merchantCounts = null) {
    // Get merchant data if not provided
    if (!merchantCounts) {
      const transactions = this.getFilteredRows();
      merchantCounts = {};
      
      transactions.forEach(transaction => {
        const merchant = transaction[2] || 'Unknown';
        merchantCounts[merchant] = (merchantCounts[merchant] || 0) + 1;
      });
    }

    // Analyze merchants for similar patterns
    const proposedGroups = this.analyzeMerchantPatterns(merchantCounts);
    
    if (proposedGroups.length === 0) {
      UI.showToast('No similar merchant patterns found', 'info');
      this.renderMerchantStepContent(); // Show regular merchant management
      return;
    }

    // Create modal backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'smart-grouping-modal';
    backdrop.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
      background: rgba(0,0,0,0.5); display: flex; align-items: center; 
      justify-content: center; z-index: 1000;
    `;
    
    backdrop.innerHTML = `
      <div style="background: var(--card-bg); border-radius: var(--radius); padding: 2rem; max-width: 800px; width: 90%; max-height: 80vh; overflow-y: auto; box-shadow: var(--shadow-lg);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border-light); padding-bottom: 1rem;">
          <h2 style="margin: 0; color: var(--text-primary);">🤖 Smart Merchant Grouping</h2>
          <button onclick="document.getElementById('smart-grouping-modal').remove(); window.budgetApp?.renderMerchantStepContent();" 
                  style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-secondary);">✖️</button>
        </div>
        
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
          I found ${proposedGroups.length} groups of similar merchants. Review and modify the proposed groupings below, then confirm to save them to Google Sheets.
        </p>
        
        <div id="proposed-groups-container" style="margin-bottom: 2rem;">
          ${proposedGroups.map((group, index) => `
            <div class="proposed-group" style="border: 1px solid var(--warning-color); border-radius: var(--radius-sm); padding: 1rem; margin-bottom: 1rem; background: linear-gradient(135deg, var(--card-bg) 0%, #fef3c7 100%);">
              <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
                <input type="checkbox" id="group-${index}" checked style="transform: scale(1.2);">
                <label for="group-${index}" style="font-weight: 600; color: var(--text-primary);">Include this group</label>
              </div>
              
              <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
                <label style="color: var(--text-secondary); font-weight: 500;">Group Name:</label>
                <input type="text" id="group-name-${index}" value="${group.groupName}" 
                       style="flex: 1; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
              </div>
              
              <div style="margin-bottom: 0.5rem;">
                <strong style="color: var(--text-secondary);">Merchants to group (${group.merchants.length}):</strong>
              </div>
              
              <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                ${group.merchants.map(merchant => `
                  <div style="display: flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.5rem; background: #fcd34d; color: #92400e; border-radius: var(--radius-sm); font-size: 0.875rem;">
                    <span>${merchant.name}</span>
                    <span style="font-size: 0.75rem; opacity: 0.8;">(${merchant.count})</span>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
        
        <div style="display: flex; gap: 1rem; justify-content: flex-end;">
          <button onclick="document.getElementById('smart-grouping-modal').remove(); window.budgetApp?.renderMerchantStepContent();" 
                  class="btn btn-secondary">Cancel</button>
          <button onclick="window.budgetApp?.confirmSmartGrouping();" 
                  class="btn btn-primary">✅ Confirm & Save to Google Sheets</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(backdrop);
  }

  // Analyze merchant patterns to find similar merchants
  analyzeMerchantPatterns(merchantCounts) {
    const merchants = Object.keys(merchantCounts);
    
    // INTELLIGENT SIMILARITY MATCHING - No hardcoded patterns needed!
    // This approach finds similar merchants using string similarity algorithms
    return this.findSimilarMerchants(merchants, merchantCounts);
  }

  // NEW: Smart similarity matching function - replaces hardcoded patterns
  findSimilarMerchants(merchants, merchantCounts) {
    const groups = [];
    const processed = new Set();
    
    // Clean and normalize merchant names for comparison
    const normalizedMerchants = merchants.map(merchant => ({
      original: merchant,
      normalized: merchant.toLowerCase()
        .replace(/[#\d\-\s]+$/, '') // Remove trailing numbers, hashes, spaces
        .replace(/\s+(inc|ltd|llc|corp|co|store|location)\.?$/i, '') // Remove business suffixes
        .replace(/[^\w\s]/g, '') // Remove special characters
        .trim(),
      count: merchantCounts[merchant]
    }));
    
    // Group by similarity
    normalizedMerchants.forEach(merchant => {
      if (processed.has(merchant.original)) return;
      
      const similar = normalizedMerchants.filter(other => 
        !processed.has(other.original) && 
        other.normalized === merchant.normalized &&
        other.original !== merchant.original
      );
      
      if (similar.length > 0) {
        // Add the original merchant to the similar group
        similar.unshift(merchant);
        
        // Mark all as processed
        similar.forEach(m => processed.add(m.original));
        
        // Create group name from the most common or longest merchant name
        const bestName = similar
          .sort((a, b) => b.count - a.count)[0]
          .original.split(/[\s#\d-]+/)[0]
          .trim();
        
        groups.push({
          groupName: bestName,
          merchants: similar.map(m => ({ name: m.original, count: m.count }))
        });
      }
    });
    
    return groups;
  }

  // CACHE MANAGEMENT for responsive merchant editing
  enableMerchantEditingCache() {
    // Store original data before making changes
    this.merchantEditingCache.originalData = JSON.parse(JSON.stringify(this.rowsData));
    this.merchantEditingCache.enabled = true;
    this.merchantEditingCache.pendingChanges.clear();
    this.merchantEditingCache.changedRows.clear();
  }

  disableMerchantEditingCache() {
    this.merchantEditingCache.enabled = false;
    this.merchantEditingCache.originalData = null;
    this.merchantEditingCache.pendingChanges.clear();
    this.merchantEditingCache.changedRows.clear();
  }

  // Apply cached changes to local data (instant UI updates)
  applyCachedMerchantChange(merchantName, newGroupName) {
    if (!this.merchantEditingCache.enabled) return;

    // Store the change
    this.merchantEditingCache.pendingChanges.set(merchantName, newGroupName);

    // Apply immediately to local data for instant UI updates
    for (let i = 1; i < this.rowsData.length; i++) {
      const row = this.rowsData[i];
      const rowMerchant = this.getColumnValue(row, 'merchant') || row[2];
      
      if (rowMerchant === merchantName) {
        // Update the merchant group in local data
        if (this.columnIndices.merchantGroup >= 0) {
          this.rowsData[i][this.columnIndices.merchantGroup] = newGroupName;
        }
        this.merchantEditingCache.changedRows.add(i);
      }
    }
  }

  // Get live merchant data with cached changes applied
  getLiveMerchantData() {
    if (!this.merchantEditingCache.enabled) {
      return this.getExistingMerchantGroups();
    }

    // Build live data from current state
    const merchantGroups = {};
    for (let i = 1; i < this.rowsData.length; i++) {
      const row = this.rowsData[i];
      const merchant = this.getColumnValue(row, 'merchant') || row[2] || 'Unknown';
      const merchantGroup = this.getColumnValue(row, 'merchantGroup');
      
      if (merchantGroup && merchantGroup.trim()) {
        if (!merchantGroups[merchantGroup.trim()]) {
          merchantGroups[merchantGroup.trim()] = [];
        }
        if (!merchantGroups[merchantGroup.trim()].includes(merchant)) {
          merchantGroups[merchantGroup.trim()].push(merchant);
        }
      }
    }
    
    return merchantGroups;
  }

  // Commit all cached changes to Google Sheets
  async commitCachedChanges() {
    if (!this.merchantEditingCache.enabled || this.merchantEditingCache.changedRows.size === 0) {
      return true;
    }

    try {
      UI.showLoading('Saving changes to Google Sheets...');
      
      const credentials = Storage.getCredentials();
      const sheetId = credentials.sheetId;
      const merchantGroupColLetter = this.sheetsAPI.numberToLetter(this.columnIndices.merchantGroup + 1);
      
      const updatePromises = [];
      
      // Update all changed rows
      for (const rowIndex of this.merchantEditingCache.changedRows) {
        const newValue = this.rowsData[rowIndex][this.columnIndices.merchantGroup];
        const rowNumber = rowIndex + 1;
        const range = `${merchantGroupColLetter}${rowNumber}`;
        
        updatePromises.push(
          this.sheetsAPI.updateCell(sheetId, range, newValue)
        );
      }
      
      await Promise.all(updatePromises);
      
      UI.hideLoading();
      UI.showToast(`✅ Saved ${this.merchantEditingCache.changedRows.size} changes to Google Sheets`, 'success');
      
      // Clear cache after successful commit
      this.disableMerchantEditingCache();
      
      return true;
    } catch (error) {
      UI.hideLoading();
      UI.handleError(error, 'Failed to save changes');
      return false;
    }
  }

  // Revert all cached changes
  revertCachedChanges() {
    if (!this.merchantEditingCache.enabled || !this.merchantEditingCache.originalData) {
      return;
    }

    // Restore original data
    this.rowsData = JSON.parse(JSON.stringify(this.merchantEditingCache.originalData));
    this.disableMerchantEditingCache();
    
    UI.showToast('🔄 Reverted all changes', 'info');
  }

  // Set OpenAI API key for merchant cleaning
  async setOpenAIKey() {
    const apiKeyInput = document.getElementById('openai-api-key');
    const apiKey = apiKeyInput?.value?.trim();
    
    if (!apiKey) {
      UI.showToast('❌ Please enter an API key', 'error');
      return;
    }
    
    try {
      UI.showToast('🔍 Validating API key...', 'info');
      
      const isValid = await this.merchantCleaner.validateApiKey(apiKey);
      
      if (isValid) {
        this.merchantCleaner.setApiKey(apiKey);
        apiKeyInput.value = '';
        UI.showToast('✅ OpenAI API key saved successfully!', 'success');
      } else {
        UI.showToast('❌ Invalid API key. Please check and try again.', 'error');
      }
    } catch (error) {
      console.error('Error validating API key:', error);
      UI.showToast('❌ Failed to validate API key', 'error');
    }
  }

  // Count unique merchants in data
  countUniqueMerchants() {
    if (!this.rowsData || this.rowsData.length <= 1) return 0;
    
    const merchantColIndex = this.columnIndices.merchant;
    if (merchantColIndex === -1) return 0;
    
    const uniqueMerchants = new Set();
    for (let i = 1; i < this.rowsData.length; i++) { // Skip header
      const merchant = this.rowsData[i][merchantColIndex];
      if (merchant && merchant.trim()) {
        uniqueMerchants.add(merchant.trim());
      }
    }
    
    return uniqueMerchants.size;
  }

  // Auto-clean only new merchants (those without merchant groups)
  async autoCleanNewMerchants() {
    try {
      const merchantColIndex = this.columnIndices.merchant;
      const merchantGroupColIndex = this.columnIndices.merchantGroup;
      
      if (merchantColIndex === -1 || merchantGroupColIndex === -1) {
        return; // Skip if columns not found
      }
      
      // Map of merchants that already have a group assigned elsewhere
      const existingMerchantGroups = new Map();
      for (let i = 1; i < this.rowsData.length; i++) {
        const row = this.rowsData[i];
        const m = row[merchantColIndex];
        const g = row[merchantGroupColIndex];
        if (m && m.trim() && g && g.trim()) {
          existingMerchantGroups.set(m.trim(), g.trim());
        }
      }

      // Track merchants needing GPT-4 cleaning and updates for duplicates
      const unclearedMerchants = new Set();
      const existingGroupUpdates = [];

      for (let i = 1; i < this.rowsData.length; i++) { // Skip header
        const row = this.rowsData[i];
        const merchant = row[merchantColIndex];
        const merchantGroup = row[merchantGroupColIndex];

        if (merchant && merchant.trim() && (!merchantGroup || merchantGroup.trim() === '')) {
          const trimmed = merchant.trim();
          if (existingMerchantGroups.has(trimmed)) {
            const existingGroup = existingMerchantGroups.get(trimmed);
            row[merchantGroupColIndex] = existingGroup;
            const columnLetter = String.fromCharCode(65 + merchantGroupColIndex);
            const cellRange = `${columnLetter}${i + 1}`;
            existingGroupUpdates.push({ range: cellRange, value: existingGroup });
          } else {
            unclearedMerchants.add(trimmed);
          }
        }
      }
      
      const credentials = Storage.getCredentials();
      const sheetId = credentials.sheetId;

      if (sheetId && existingGroupUpdates.length > 0) {
        try {
          await this.sheetsAPI.batchUpdateCells(sheetId, existingGroupUpdates);
        } catch (e) {
          console.error('Failed to apply existing merchant group updates:', e);
        }
      }

      if (unclearedMerchants.size === 0) {
        return 0; // All merchants already grouped
      }

      // Show cleaning progress on loading screen
      UI.setLoadingMessage(`🤖 Auto-cleaning ${unclearedMerchants.size} merchant names with GPT-4...`);

      // Clean only the new merchant names
      const merchantNames = Array.from(unclearedMerchants);
      const cleaningResults = await this.merchantCleaner.cleanMerchantNames(merchantNames);

      // Update Merchant Group column for new merchants only
      if (!sheetId) return;
      
      const updates = [];
      for (let i = 1; i < this.rowsData.length; i++) { // Skip header
        const row = this.rowsData[i];
        const merchant = row[merchantColIndex];
        const merchantGroup = row[merchantGroupColIndex];
        
        // Only update if no merchant group exists and we have a cleaning result
        if (merchant && merchant.trim() && 
            (!merchantGroup || merchantGroup.trim() === '') &&
            cleaningResults.has(merchant.trim())) {
          
          const cleanedName = cleaningResults.get(merchant.trim());
          const columnLetter = String.fromCharCode(65 + merchantGroupColIndex);
          const cellRange = `${columnLetter}${i + 1}`;
          updates.push({ range: cellRange, value: cleanedName });
          
          // Update local data immediately for faster UI response
          row[merchantGroupColIndex] = cleanedName;
        }
      }
      
      if (updates.length > 0) {
        // Show edit dialog for user to review GPT-4 changes before saving
        UI.setLoadingMessage(`🤖 GPT-4 cleaned ${updates.length} merchants. Opening review dialog...`);
        
        // Store the updates globally for the edit dialog
        this.pendingMerchantUpdates = updates;
        this.pendingCleaningResults = cleaningResults;
        
        // Keep loading screen visible and show edit dialog
        this.showMerchantCleaningDialog(updates, cleaningResults);
        
        return updates.length; // Return count of merchants ready for review
      }
      
      return 0; // No merchants cleaned
      
    } catch (error) {
      console.error('Error in auto-cleaning merchants:', error);
      // Don't show error toast for auto-cleaning to avoid disrupting user flow
      return 0;
    }
  }

  // Apply sheet updates in background without blocking UI
  async applySheetUpdatesInBackground(sheetId, updates) {
    try {
      for (const update of updates) {
        await this.sheetsAPI.updateCell(sheetId, update.range, update.value);
      }
    } catch (error) {
      console.error('Background sheet update failed:', error);
      // Could retry or queue for later
    }
  }

  // Clean all merchants automatically
  async cleanAllMerchants() {
    if (!confirm('This will automatically clean all merchant names using AI/regex patterns. Continue?')) {
      return;
    }
    
    try {
      UI.showToast('🧹 Starting merchant cleaning...', 'info');
      
      // Get all unique merchant names
      const merchantNames = [...new Set(
        this.rowsData.slice(1) // Skip header
          .map(row => row[this.columnIndices.merchant])
          .filter(name => name && name.trim())
      )];
      
      if (merchantNames.length === 0) {
        UI.showToast('❌ No merchants found to clean', 'error');
        return;
      }
      
      // Clean all merchant names
      const cleaningResults = await this.merchantCleaner.cleanMerchantNames(merchantNames);
      
      // Update Merchant Group column for each row
      const credentials = Storage.getCredentials();
      const sheetId = credentials.sheetId;
      
      if (!sheetId) {
        UI.showToast('❌ No sheet ID found', 'error');
        return;
      }
      
      const merchantGroupColIndex = this.columnIndices.merchantGroup;
      if (merchantGroupColIndex === -1) {
        UI.showToast('❌ Merchant Group column not found', 'error');
        return;
      }
      
      // Build updates for all rows
      const updates = [];
      for (let i = 1; i < this.rowsData.length; i++) { // Skip header
        const row = this.rowsData[i];
        const originalMerchant = row[this.columnIndices.merchant];
        
        if (originalMerchant && cleaningResults.has(originalMerchant)) {
          const cleanedName = cleaningResults.get(originalMerchant);
          if (cleanedName !== originalMerchant) {
            const columnLetter = String.fromCharCode(65 + merchantGroupColIndex);
            const cellRange = `${columnLetter}${i + 1}`;
            updates.push({ range: cellRange, value: cleanedName });
          }
        }
      }
      
      if (updates.length === 0) {
        UI.showToast('ℹ️ No merchant names needed cleaning', 'info');
        return;
      }
      
      // Apply updates to sheet
      UI.showToast(`📝 Updating ${updates.length} merchant groups...`, 'info');
      
      for (const update of updates) {
        await this.sheetsAPI.updateCell(sheetId, update.range, update.value);
      }
      
      // Reload data to show changes
      if (credentials.useAppsScript) {
        await this.loadDataFromAppsScript();
      } else {
        await this.loadData(sheetId);
      }
      
      UI.showToast(`✅ Successfully cleaned ${updates.length} merchants!`, 'success');
      
    } catch (error) {
      console.error('Error cleaning merchants:', error);
      UI.showToast('❌ Failed to clean merchants', 'error');
    }
  }

  // Clear all Merchant Group values
  async clearAllMerchantGroups() {
    if (!confirm('This will clear ALL Merchant Group values in your spreadsheet. Are you sure?')) {
      return;
    }
    
    try {
      UI.showToast('🔄 Clearing all Merchant Groups...', 'info');
      
      const merchantGroupColIndex = this.columnIndices.merchantGroup;
      if (merchantGroupColIndex === -1) {
        UI.showToast('❌ Merchant Group column not found', 'error');
        return;
      }
      
      // Get column letter for Merchant Group (A=0, B=1, etc.)
      const columnLetter = String.fromCharCode(65 + merchantGroupColIndex);
      
      // Clear all values in the Merchant Group column (except header)
      const range = `${columnLetter}2:${columnLetter}${this.rowsData.length}`;
      const clearValues = new Array(this.rowsData.length - 1).fill(['']);
      
      // Get the current sheet ID
      const credentials = Storage.getCredentials();
      const sheetId = credentials.sheetId;
      
      if (!sheetId) {
        UI.showToast('❌ No sheet ID found', 'error');
        return;
      }
      
      // Use updateRange method to clear all values
      await this.sheetsAPI.updateRange(sheetId, range, clearValues);
      
      // Reload data to reflect changes
      if (credentials.useAppsScript) {
        await this.loadDataFromAppsScript();
      } else {
        await this.loadData(sheetId);
      }
      
      UI.showToast('✅ All Merchant Groups cleared successfully!', 'success');
    } catch (error) {
      console.error('Error clearing merchant groups:', error);
      UI.showToast('❌ Failed to clear Merchant Groups', 'error');
    }
  }

  // Show merchant cleaning review dialog
  showMerchantCleaningDialog(updates, cleaningResults) {
    // Create modal HTML
    const modalHTML = `
      <div class="modal-overlay" id="merchant-cleaning-modal">
        <div class="modal" style="max-width: 800px; max-height: 80vh;">
          <div class="modal-header">
            <h3>🤖 Review GPT-4 Merchant Cleaning</h3>
            <p>Review and edit the merchant name changes before saving to Google Sheets.</p>
          </div>
          <div class="modal-content" style="max-height: 400px; overflow-y: auto;">
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background: var(--bg-secondary);">
                  <th style="padding: 0.5rem; border: 1px solid var(--border-color);">Original Merchant</th>
                  <th style="padding: 0.5rem; border: 1px solid var(--border-color);">GPT-4 Cleaned</th>
                  <th style="padding: 0.5rem; border: 1px solid var(--border-color);">Your Edit</th>
                </tr>
              </thead>
              <tbody id="cleaning-results-table">
              </tbody>
            </table>
          </div>
          <div class="modal-footer" style="display: flex; gap: 1rem; justify-content: flex-end;">
            <button onclick="window.budgetApp.cancelMerchantCleaning()" class="btn btn-secondary">
              ❌ Cancel
            </button>
            <button onclick="window.budgetApp.saveMerchantCleaning()" class="btn btn-primary">
              💾 Save to Google Sheets
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Populate table with cleaning results
    const tableBody = document.getElementById('cleaning-results-table');
    const uniqueMerchants = new Set();
    
    updates.forEach((update) => {
      // Find original merchant name for this update
      const rowIndex = parseInt(update.range.match(/\d+/)[0]) - 1; // Convert A5 to row 4 (0-indexed)
      const row = this.rowsData[rowIndex];
      const originalMerchant = row[this.columnIndices.merchant];
      
      if (!uniqueMerchants.has(originalMerchant)) {
        uniqueMerchants.add(originalMerchant);
        
        const cleanedValue = update.value;
        
        const rowHTML = `
          <tr>
            <td style="padding: 0.5rem; border: 1px solid var(--border-color); font-family: monospace;">
              ${originalMerchant}
            </td>
            <td style="padding: 0.5rem; border: 1px solid var(--border-color); color: var(--primary-color); font-weight: 500;">
              ${cleanedValue}
            </td>
            <td style="padding: 0.5rem; border: 1px solid var(--border-color);">
              <input type="text" 
                     value="${cleanedValue}" 
                     data-original="${originalMerchant}"
                     style="width: 100%; padding: 0.25rem; border: 1px solid var(--border-color); border-radius: 4px;"
                     placeholder="Edit if needed...">
            </td>
          </tr>
        `;
        
        tableBody.insertAdjacentHTML('beforeend', rowHTML);
      }
    });
  }

  // Cancel merchant cleaning and close dialog
  cancelMerchantCleaning() {
    // Remove modal
    const modal = document.getElementById('merchant-cleaning-modal');
    if (modal) modal.remove();
    
    // Hide loading screen and show welcome
    UI.hideLoading();
    this.showView('welcome');
    
    UI.showToast('❌ Merchant cleaning cancelled', 'info');
  }

  // Save merchant cleaning changes to Google Sheets
  async saveMerchantCleaning() {
    console.log('saveMerchantCleaning called!'); // Debug
    try {
      const modal = document.getElementById('merchant-cleaning-modal');
      const inputs = modal.querySelectorAll('input[data-original]');
      
      console.log('Found inputs:', inputs.length); // Debug
      
      UI.setLoadingMessage('💾 Saving your merchant changes to Google Sheets...');
      
      // Build final update list based on user edits
      const finalUpdates = [];
      const userEdits = new Map();
      
      // Collect user edits
      inputs.forEach(input => {
        const originalMerchant = input.dataset.original;
        const userValue = input.value.trim();
        console.log(`User edit: "${originalMerchant}" → "${userValue}"`); // Debug
        userEdits.set(originalMerchant, userValue);
      });
      
      console.log('User edits collected:', userEdits.size); // Debug
      console.log('Pending updates:', this.pendingMerchantUpdates?.length || 0); // Debug
      
      // Update pending updates with user edits
      this.pendingMerchantUpdates.forEach(update => {
        const rowIndex = parseInt(update.range.match(/\d+/)[0]) - 1;
        const row = this.rowsData[rowIndex];
        const originalMerchant = row[this.columnIndices.merchant];
        
        console.log(`Processing update for "${originalMerchant}" at ${update.range}`); // Debug
        
        if (userEdits.has(originalMerchant)) {
          const finalValue = userEdits.get(originalMerchant);
          finalUpdates.push({
            range: update.range,
            value: finalValue
          });
          
          console.log(`Will update ${update.range} with "${finalValue}"`); // Debug
          
          // Update local data immediately
          row[this.columnIndices.merchantGroup] = finalValue;
        }
      });
      
      console.log('Final updates to save:', finalUpdates.length); // Debug
      
      // Save to Google Sheets using batch update for better performance
      const credentials = Storage.getCredentials();
      console.log('Using credentials:', credentials); // Debug
      let successCount = 0;
      
      if (!credentials.sheetId) {
        throw new Error('No sheet ID found in credentials');
      }
      
      if (finalUpdates.length === 0) {
        console.log('No updates to save'); // Debug
        successCount = 0;
      } else {
        try {
          UI.setLoadingMessage(`💾 Saving ${finalUpdates.length} merchant groups to Google Sheets (batch update)...`);
          
          // Use batch update for much better performance
          const result = await this.sheetsAPI.batchUpdateCells(credentials.sheetId, finalUpdates);
          console.log('Batch update result:', result); // Debug
          
          // If batch update succeeds, assume all updates were successful
          successCount = finalUpdates.length;
          
          UI.setLoadingMessage(`✅ Successfully saved ${successCount} merchant groups!`);
          
        } catch (batchError) {
          console.error('Batch update failed, falling back to individual updates:', batchError);
          
          // Show setup help if this looks like an Apps Script configuration issue
          if (batchError.message.includes('Apps Script') || batchError.message.includes('BATCH_UPDATE')) {
            this.showAppsScriptUpdateHelp();
          }
          
          // If batch update fails, fall back to individual updates
          UI.setLoadingMessage('⚠️ Batch update failed, trying individual updates...');
          
          for (let i = 0; i < finalUpdates.length; i++) {
            const update = finalUpdates[i];
            console.log(`Saving update ${i+1}/${finalUpdates.length}: ${update.range} = "${update.value}"`); // Debug
            
            try {
              const result = await this.sheetsAPI.updateCell(credentials.sheetId, update.range, update.value);
              console.log('Update result:', result); // Debug
              successCount++;
              
              if (i % 10 === 0) {
                UI.setLoadingMessage(`💾 Saved ${successCount}/${finalUpdates.length} merchants...`);
              }
            } catch (error) {
              console.error(`Failed to save merchant update ${update.range}:`, error);
              
              // If this is an Apps Script error, provide helpful guidance
              if (credentials.useAppsScript && error.message.includes('Update failed')) {
                console.error('APPS SCRIPT UPDATE ERROR: Your Apps Script needs to handle BATCH_UPDATE requests.');
                console.error('Add this to your Apps Script:');
                console.error(`
function doGet(e) {
  const method = e.parameter.method || 'GET';
  
  if (method === 'BATCH_UPDATE') {
    return handleBatchUpdate(e.parameter);
  }
  if (method === 'UPDATE') {
    return handleUpdate(e.parameter);
  }
  // ... your existing GET logic
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  if (data.method === 'BATCH_UPDATE') {
    return handleBatchUpdate(data);
  }
  if (data.method === 'UPDATE') {
    return handleUpdate(data);
  }
  // ... other POST logic
}

function handleBatchUpdate(params) {
  try {
    const sheetId = params.sheetId;
    const updates = params.updates; // Array of {range, value} objects
    
    const sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
    
    // Process all updates in a single operation for much better performance
    updates.forEach(update => {
      sheet.getRange(update.range).setValue(update.value);
    });
    
    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        updatedCells: updates.length,
        message: 'Batch update completed successfully'
      }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        error: error.toString(),
        success: false
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
                `);
              }
            }
          }
        }
      }
      
      console.log(`Successfully saved ${successCount}/${finalUpdates.length} updates`); // Debug
      
      // Remove modal
      modal.remove();
      
      if (successCount === 0 && finalUpdates.length > 0) {
        // None of the updates succeeded
        UI.setLoadingMessage('❌ Failed to save merchant changes');
        UI.showToast('❌ Your Apps Script needs to be updated to handle merchant group updates. Check the console for details.', 'error', 10000);
        
        // Still show enter app button so user can proceed
        setTimeout(() => {
          UI.showEnterAppButton();
        }, 2000);
      } else if (successCount < finalUpdates.length) {
        // Some updates failed
        UI.setLoadingMessage(`⚠️ Partial save: ${successCount}/${finalUpdates.length} merchants saved`);
        UI.showToast(`⚠️ Only ${successCount} of ${finalUpdates.length} merchant groups were saved successfully`, 'warning');
        
        setTimeout(() => {
          UI.showEnterAppButton();
        }, 1000);
      } else {
        // All updates succeeded
        UI.setLoadingMessage('✅ Merchant cleaning complete!');
        UI.setProgress(100);
        
        setTimeout(() => {
          UI.showEnterAppButton();
          UI.showToast(`✅ Saved ${successCount} merchant groups to Google Sheets!`, 'success');
        }, 1000);
      }
      
    } catch (error) {
      console.error('Error saving merchant cleaning:', error);
      UI.showToast('❌ Failed to save merchant changes', 'error');
      
      // Show Apps Script setup help if needed
      const credentials = Storage.getCredentials();
      if (credentials.useAppsScript) {
        this.showAppsScriptUpdateHelp();
      }
    }
  }

  // Show Apps Script setup help
  showAppsScriptUpdateHelp() {
    const appsScriptCode = `function doGet(e) {
  const method = e.parameter.method || 'GET';
  
  if (method === 'BATCH_UPDATE') {
    return handleBatchUpdate(e.parameter);
  }
  if (method === 'UPDATE') {
    return handleUpdate(e.parameter);
  }
  
  // Your existing GET logic here...
  // (keep your current data loading code)
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  
  if (data.method === 'BATCH_UPDATE') {
    return handleBatchUpdate(data);
  }
  if (data.method === 'UPDATE') {
    return handleUpdate(data);
  }
  
  // Your existing POST logic here...
}

// FAST batch update - saves hundreds of merchants at once
function handleBatchUpdate(params) {
  try {
    const sheetId = params.sheetId;
    const updates = params.updates; // Array of {range, value} objects
    
    const sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
    
    // Process all updates efficiently
    updates.forEach(update => {
      sheet.getRange(update.range).setValue(update.value);
    });
    
    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        updatedCells: updates.length,
        message: \`Batch update completed: \${updates.length} cells updated\`
      }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        error: error.toString(),
        success: false
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Single cell update (fallback)
function handleUpdate(params) {
  try {
    const sheetId = params.sheetId;
    const range = params.range;
    const values = params.values; // Will be array like [["New Merchant Name"]]
    
    const sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
    sheet.getRange(range).setValues(values);
    
    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        updatedCells: 1,
        message: 'Cell updated successfully'
      }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        error: error.toString(),
        success: false
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;

    UI.createModal(
      '🚀 Apps Script Batch Update Required',
      `<div style="max-height: 400px; overflow-y: auto;">
        <p><strong>Your Apps Script needs BATCH_UPDATE support for fast merchant group saving!</strong></p>
        <p style="color: var(--warning-color);">⚡ This will save 500+ merchants in seconds instead of minutes!</p>
        <p>Add this code to your Google Apps Script project:</p>
        <pre style="background: var(--bg-secondary); padding: 1rem; border-radius: var(--radius-sm); font-size: 0.75rem; overflow-x: auto; white-space: pre-wrap;">${appsScriptCode}</pre>
        <p style="margin-top: 1rem;"><strong>Steps:</strong></p>
        <ol style="padding-left: 1.5rem;">
          <li>Open your Google Apps Script project</li>
          <li>Add the <code>handleBatchUpdate</code> function above</li>
          <li>Update your <code>doGet</code> and <code>doPost</code> functions</li>
          <li>Deploy the updated script</li>
          <li>Try saving merchant groups again (will be much faster!)</li>
        </ol>
      </div>`,
      [
        { text: 'Copy Code', class: 'btn-secondary', action: `navigator.clipboard.writeText(\`${appsScriptCode.replace(/`/g, '\\`')}\`); UI.showToast('📋 Apps Script code copied to clipboard!', 'success')` },
        { text: 'Got It', class: 'btn-primary', action: 'this.closest(".modal-overlay").remove()' }
      ]
    );
  }

  // Enter the app after loading is complete
  enterApp() {
    try {
      // Hide loading screen
      UI.hideLoading();
      
      // Update all UI components with the loaded data
      if (this.loadedTransactions) {
        this.updateAllViews(this.loadedTransactions);
        UI.showToast(`✅ Successfully loaded ${this.loadedTransactions.length} transactions`, 'success');
      }
      
      // Check merchant grouping status and auto-navigate if needed
      this.checkMerchantGroupingStatus();
      
      // Show main app
      this.showView('dashboard');
      
    } catch (error) {
      UI.handleError(error, 'Entering app');
    }
  }

  // REBUILT: Simple transaction search functionality
  searchTransactions(searchTerm) {
    this.transactionSearchTerm = searchTerm.trim().toLowerCase();
    if (this.currentView === 'transactions') {
      this.renderTransactionsView();
    }
  }

  clearTransactionSearch() {
    this.transactionSearchTerm = '';
    const searchInput = document.getElementById('transaction-search');
    if (searchInput) {
      searchInput.value = '';
    }
    if (this.currentView === 'transactions') {
      this.renderTransactionsView();
    }
  }

  // Accept all merchant changes and close dialog
  async acceptMerchantChanges() {
    const success = await this.commitCachedChanges();
    if (success) {
      // Close the modal
      const modal = document.getElementById('merchant-edit-modal');
      if (modal) {
        modal.remove();
      }
      
      // Refresh the current view to show updated data
      this.renderMerchantStepContent();
      UI.showToast('🎉 All merchant changes saved successfully!', 'success');
    }
  }

  // Cancel all merchant changes and close dialog
  cancelMerchantChanges() {
    if (this.merchantEditingCache.enabled && this.merchantEditingCache.changedRows.size > 0) {
      if (confirm('You have unsaved changes. Are you sure you want to discard them?')) {
        this.revertCachedChanges();
        const modal = document.getElementById('merchant-edit-modal');
        if (modal) {
          modal.remove();
        }
      }
    } else {
      this.disableMerchantEditingCache();
      const modal = document.getElementById('merchant-edit-modal');
      if (modal) {
        modal.remove();
      }
    }
  }

  // Confirm and save smart grouping results
  async confirmSmartGrouping() {
    try {
      UI.showLoading('Saving merchant groups to Google Sheets...');
      
      const modal = document.getElementById('smart-grouping-modal');
      if (!modal) return;
      
      const proposedGroups = modal.querySelectorAll('.proposed-group');
      const updatePromises = [];
      
      const credentials = Storage.getCredentials();
      const sheetId = credentials.sheetId;
      const merchantGroupColLetter = this.sheetsAPI.numberToLetter(this.columnIndices.merchantGroup + 1);
      
      // Process each proposed group
      proposedGroups.forEach((groupElement, index) => {
        const checkbox = groupElement.querySelector(`#group-${index}`);
        const groupNameInput = groupElement.querySelector(`#group-name-${index}`);
        
        if (checkbox?.checked && groupNameInput?.value?.trim()) {
          const groupName = groupNameInput.value.trim();
          
          // Get merchants from this group
          const merchantElements = groupElement.querySelectorAll('[style*="background: #fcd34d"]');
          merchantElements.forEach(merchantElement => {
            const merchantName = merchantElement.querySelector('span').textContent.trim();
            
            // Find all rows with this merchant and update their merchant group
            for (let i = 1; i < this.rowsData.length; i++) {
              const row = this.rowsData[i];
              const rowMerchant = row[this.columnIndices.merchant] || row[2];
              
              if (rowMerchant === merchantName) {
                const rowNumber = i + 1;
                const range = `${merchantGroupColLetter}${rowNumber}`;
                
                updatePromises.push(
                  this.sheetsAPI.updateCell(sheetId, range, groupName)
                );
              }
            }
          });
        }
      });
      
      if (updatePromises.length === 0) {
        UI.hideLoading();
        UI.showToast('No groups selected for saving', 'info');
        return;
      }
      
      await Promise.all(updatePromises);
      
      UI.hideLoading();
      UI.showToast(`Successfully created ${updatePromises.length > 0 ? 'merchant groups' : 'no groups'}!`, 'success');
      
      // Close modal and reload data
      modal.remove();
      await this.loadDataFromAppsScript();
      this.renderMerchantStepContent();
      
    } catch (error) {
      UI.hideLoading();
      UI.handleError(error, 'Failed to save merchant groups');
    }
  }

  // Setup keyboard shortcuts
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + R: Refresh data
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        const sheetId = Storage.get(CONFIG.STORAGE_KEYS.SHEET_ID);
        if (sheetId) {
          this.loadData(sheetId);
        }
      }
    });
  }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Ensure loading is hidden initially
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) {
    loadingOverlay.style.display = 'none';
  }
  
  window.budgetApp = new BudgetTrackerApp();
  window.budgetApp.init();
  
  // Check if APIs are already loaded
  if (window.gapiLoaded && window.gisLoaded) {
    setTimeout(() => window.budgetApp.onAPIsReady(), 100);
  }
});

// Export for global access
export { BudgetTrackerApp };