// Chart visualization using Plotly.js
import { Formatters } from '../utils/formatters.js';

export class ChartManager {
  constructor() {
    this.defaultLayout = {
      margin: { t: 20, l: 50, r: 20, b: 100 },
      showlegend: false,
      font: { family: 'system-ui, sans-serif' },
      plot_bgcolor: 'transparent',
      paper_bgcolor: 'transparent'
    };

    this.defaultConfig = {
      responsive: true,
      displayModeBar: false,
      staticPlot: false
    };
  }

  // Draw main account/spending chart based on timeframe
  drawSpendingChart(transactions, containerId = 'chart') {
    // Handle empty data
    if (!transactions || transactions.length === 0) {
      this.renderEmptyChart(containerId);
      return;
    }

    const currentPeriod = this.getCurrentPeriod();
    let chartData, chartTitle;

    switch (currentPeriod) {
      case 'year':
        chartData = this.groupByMonth(transactions);
        chartTitle = 'Spending by Month';
        break;
      case 'month':
        chartData = this.groupByWeek(transactions);
        chartTitle = 'Spending by Week';
        break;
      case 'week':
      case 'payweek':
        chartData = this.groupByDay(transactions);
        chartTitle = 'Spending by Day';
        break;
      default:
        chartData = this.groupByAccount(transactions);
        chartTitle = 'Spending by Account';
    }

    this.renderBarChart(containerId, chartData, chartTitle);
    this.updateChartTitle(chartTitle);
  }

  // Group transactions by month
  groupByMonth(transactions) {
    const monthlyTotals = {};
    
    transactions.forEach(transaction => {
      if (transaction[4]) { // Check if date exists
        const date = new Date(transaction[4]);
        const monthKey = Formatters.date(date, 'monthYear');
        monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + Math.abs(transaction[1]);
      }
    });

    return {
      labels: Object.keys(monthlyTotals),
      values: Object.values(monthlyTotals)
    };
  }

  // Group transactions by week
  groupByWeek(transactions) {
    const weeklyTotals = {};
    
    transactions.forEach(transaction => {
      if (transaction[4]) {
        const date = new Date(transaction[4]);
        const weekStart = new Date(date.setDate(date.getDate() - date.getDay()));
        const weekKey = Formatters.date(weekStart, 'dayMonth');
        weeklyTotals[weekKey] = (weeklyTotals[weekKey] || 0) + Math.abs(transaction[1]);
      }
    });

    return {
      labels: Object.keys(weeklyTotals),
      values: Object.values(weeklyTotals)
    };
  }

  // Group transactions by day
  groupByDay(transactions) {
    const dailyTotals = {};
    
    transactions.forEach(transaction => {
      if (transaction[4]) {
        const date = new Date(transaction[4]);
        const dayKey = Formatters.date(date, 'weekday');
        dailyTotals[dayKey] = (dailyTotals[dayKey] || 0) + Math.abs(transaction[1]);
      }
    });

    return {
      labels: Object.keys(dailyTotals),
      values: Object.values(dailyTotals)
    };
  }

  // Group transactions by account
  groupByAccount(transactions) {
    const accountTotals = {};
    
    transactions.forEach(transaction => {
      const account = transaction[0] || 'Uncategorized';
      accountTotals[account] = (accountTotals[account] || 0) + Math.abs(transaction[1]);
    });

    return {
      labels: Object.keys(accountTotals),
      values: Object.values(accountTotals)
    };
  }

  // Render bar chart
  renderBarChart(containerId, data, title = '') {
    const chartData = [{
      x: data.labels,
      y: data.values,
      type: 'bar',
      marker: { color: '#6366f1' },
      textposition: 'outside',
      text: data.values.map(v => Formatters.currency(v)),
      hovertemplate: '%{x}<br>%{text}<extra></extra>'
    }];

    const layout = {
      ...this.defaultLayout,
      title: title,
      xaxis: { title: '' },
      yaxis: { title: 'Amount ($)' }
    };

    Plotly.newPlot(containerId, chartData, layout, this.defaultConfig);
  }

  // Render pie chart for category distribution
  renderCategoryPieChart(transactions, containerId = 'category-chart') {
    if (!transactions || transactions.length === 0) {
      return; // Skip rendering if no data
    }

    const categoryTotals = {};
    
    transactions.forEach(transaction => {
      const category = transaction[7] || 'Uncategorized';
      categoryTotals[category] = (categoryTotals[category] || 0) + Math.abs(transaction[1]);
    });

    const sortedData = Object.entries(categoryTotals)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 8); // Top 8 categories

    const chartData = [{
      labels: sortedData.map(([category]) => category),
      values: sortedData.map(([, amount]) => amount),
      type: 'pie',
      textinfo: 'label+percent',
      textposition: 'auto',
      hovertemplate: '%{label}<br>%{value:$,.2f}<br>%{percent}<extra></extra>',
      marker: {
        colors: [
          '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
          '#f97316', '#f59e0b', '#eab308', '#84cc16'
        ]
      }
    }];

    const layout = {
      ...this.defaultLayout,
      title: 'Spending by Category',
      showlegend: true,
      legend: { orientation: 'h', y: -0.1 }
    };

    Plotly.newPlot(containerId, chartData, layout, this.defaultConfig);
  }

  // Render line chart for spending trends
  renderTrendChart(transactions, containerId = 'trend-chart') {
    if (!transactions || transactions.length === 0) {
      return; // Skip rendering if no data
    }

    const dailyTotals = {};
    
    transactions.forEach(transaction => {
      if (transaction[4]) {
        const date = new Date(transaction[4]);
        const dateKey = date.toISOString().split('T')[0];
        dailyTotals[dateKey] = (dailyTotals[dateKey] || 0) + Math.abs(transaction[1]);
      }
    });

    const sortedDates = Object.keys(dailyTotals).sort();
    const values = sortedDates.map(date => dailyTotals[date]);

    const chartData = [{
      x: sortedDates,
      y: values,
      type: 'scatter',
      mode: 'lines+markers',
      line: { color: '#6366f1', width: 2 },
      marker: { color: '#6366f1', size: 6 },
      hovertemplate: '%{x}<br>%{y:$,.2f}<extra></extra>'
    }];

    const layout = {
      ...this.defaultLayout,
      title: 'Spending Trend',
      xaxis: { title: 'Date', type: 'date' },
      yaxis: { title: 'Amount ($)' }
    };

    Plotly.newPlot(containerId, chartData, layout, this.defaultConfig);
  }

  // Get current period from UI
  getCurrentPeriod() {
    const activeBtn = document.querySelector('.period-btn.active');
    return activeBtn ? activeBtn.getAttribute('data-period') : 'month';
  }

  // Update chart title in UI
  updateChartTitle(title) {
    const titleElement = document.querySelector('#dashboard-view .chart-title');
    if (titleElement) {
      titleElement.textContent = `📊 ${title}`;
    }
  }

  // Render empty chart
  renderEmptyChart(containerId) {
    const element = document.getElementById(containerId);
    if (element) {
      element.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 300px; color: var(--text-secondary);">
          <div style="text-align: center;">
            <div style="font-size: 2rem; margin-bottom: 1rem;">📊</div>
            <div>Connect to Google Sheets to view your spending data</div>
          </div>
        </div>
      `;
    }
  }

  // Update all charts
  updateAllCharts(transactions) {
    this.drawSpendingChart(transactions);
    // Only render category chart if the element exists
    if (document.getElementById('category-chart')) {
      this.renderCategoryPieChart(transactions);
    }
    // Only render trend chart if the element exists
    if (document.getElementById('trend-chart')) {
      this.renderTrendChart(transactions);
    }
  }

  // Resize charts (useful for responsive design)
  resizeCharts() {
    const chartContainers = ['chart', 'category-chart', 'trend-chart'];
    chartContainers.forEach(id => {
      const element = document.getElementById(id);
      if (element && element.data) {
        Plotly.Plots.resize(element);
      }
    });
  }
}