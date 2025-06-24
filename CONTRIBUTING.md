# Contributing to BudgetTracker Pro

Thank you for your interest in contributing to BudgetTracker Pro! This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/budget-tracker-web.git`
3. Create a new branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Test thoroughly
6. Submit a pull request

## Development Setup

### Prerequisites
- Python 3.6+ (for local development server)
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Google Apps Script access
- OpenAI API key (optional, for AI features)

### Local Development
```bash
# Clone the repository
git clone https://github.com/yourusername/budget-tracker-web.git
cd budget-tracker-web

# Start local development server
npm run dev
# or
python3 -m http.server 8000

# Open in browser
open http://localhost:8000
```

## Project Structure

```
budget-tracker-web/
├── index.html                 # Main HTML file
├── config/
│   └── settings.js           # App configuration
├── js/
│   ├── main.js              # Main application class
│   ├── modules/             # Feature modules
│   │   ├── categories.js    # Category management
│   │   ├── charts.js        # Chart rendering
│   │   ├── drive-picker.js  # Google Drive integration
│   │   └── sheets-api.js    # Google Sheets API
│   ├── services/
│   │   └── merchant-cleaner.js # AI merchant cleaning
│   └── utils/               # Utility functions
│       ├── formatters.js    # Data formatting
│       ├── storage.js       # LocalStorage management
│       ├── ui.js            # UI utilities
│       ├── url-parser.js    # URL parsing
│       └── validators.js    # Input validation
├── styles/
│   └── main.css            # Application styles
├── apps-script-template.js  # Google Apps Script template
└── README.md               # Project documentation
```

## Coding Standards

### JavaScript
- Use ES6+ features and modules
- Prefer `const` and `let` over `var`
- Use meaningful variable and function names
- Add JSDoc comments for public methods
- Handle errors gracefully with try-catch blocks
- Use async/await for asynchronous operations

### CSS
- Use CSS custom properties (variables) for theming
- Follow BEM methodology for class naming
- Ensure responsive design principles
- Test on multiple screen sizes

### HTML
- Use semantic HTML elements
- Ensure accessibility (ARIA labels, proper headings)
- Validate HTML structure

## Testing

### Manual Testing Checklist
- [ ] Connection to Google Sheets works
- [ ] Data loads correctly
- [ ] All views render properly
- [ ] Charts display correctly
- [ ] Merchant cleaning functions work
- [ ] Budget calculations are accurate
- [ ] Search and filtering work
- [ ] Mobile responsiveness
- [ ] Error handling works properly

### Browser Testing
Test on:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Feature Guidelines

### Adding New Features
1. Create a new branch for your feature
2. Follow the existing code structure
3. Add appropriate error handling
4. Update documentation
5. Test thoroughly
6. Submit a pull request with description

### Modifying Existing Features
1. Understand the current implementation
2. Maintain backward compatibility
3. Update related documentation
4. Test affected functionality
5. Consider performance implications

## Pull Request Process

1. **Description**: Provide a clear description of what your PR does
2. **Testing**: Describe how you tested your changes
3. **Documentation**: Update README.md if needed
4. **Screenshots**: Include screenshots for UI changes
5. **Breaking Changes**: Clearly mark any breaking changes

### PR Template
```
## Description
Brief description of the changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Manual testing completed
- [ ] Cross-browser testing
- [ ] Mobile testing (if applicable)

## Screenshots
(If applicable)

## Additional Notes
Any additional information
```

## Code Review Guidelines

### For Contributors
- Write clear, self-documenting code
- Include comments for complex logic
- Follow existing patterns and conventions
- Keep changes focused and atomic

### For Reviewers
- Be constructive and helpful
- Focus on code quality and maintainability
- Check for security implications
- Verify functionality works as expected

## Common Issues and Solutions

### Google Apps Script Issues
- Ensure proper CORS headers are set
- Verify deployment settings (Execute as "Me", Access "Anyone")
- Check Apps Script logs for errors
- Validate sheet ID and range formats

### API Integration Issues
- Check API key validity
- Verify network connectivity
- Handle rate limiting appropriately
- Implement proper error handling

### Performance Issues
- Use batch operations for bulk updates
- Implement client-side caching
- Optimize chart rendering
- Minimize DOM manipulations

## Security Considerations

- Never commit API keys or sensitive data
- Validate all user inputs
- Use HTTPS for all external requests
- Implement proper error handling to avoid information leakage
- Follow OWASP guidelines for web security

## Documentation

- Update README.md for new features
- Add JSDoc comments for public methods
- Update inline comments for complex logic
- Include setup instructions for new integrations

## Release Process

1. Update version in package.json
2. Update CHANGELOG.md
3. Create release branch
4. Final testing
5. Merge to main
6. Create GitHub release
7. Update documentation

## Questions?

If you have questions about contributing:
1. Check existing issues and discussions
2. Create a new issue for bugs or feature requests
3. Start a discussion for general questions

Thank you for contributing to BudgetTracker Pro! 🚀