# CSS Organization Quick Reference

## File Structure
```
/static/css/
├── main.css              # Global styles, variables, base layout
├── landing.css           # Landing page
├── profile.css           # Profile-specific styling
├── home.css              # Home page (NEW)
├── messages.css          # Messaging interface (NEW)
└── connections.css       # Connections management (NEW)
```

## Which CSS File to Edit

| Page | Template | CSS File(s) |
|------|----------|------------|
| Home Page | `home.html` | `home.css` |
| Messages/Chat | `start_message_chat.html` | `messages.css` |
| Connections | `connections.html` | `connections.css` |
| User Profile | `profile.html` | `profile.css`, `connections.css` |
| Base Layout | `base.html` | `main.css` |
| Landing Page | `landing.html` | `landing.css` |

## How to Add New Styles

### For Home Page
1. Edit `/static/css/home.css`
2. Add your class following the naming convention
3. Use CSS custom properties from `main.css` (e.g., `var(--primary)`)

```css
.new-home-section {
  padding: 24px;
  background: var(--card);
  border-radius: var(--radius);
}
```

### For Messaging Features
1. Edit `/static/css/messages.css`
2. Add styles for user list, chat area, or input handling

```css
.message-notification {
  display: inline-block;
  background: var(--warning);
  border-radius: 50%;
  padding: 2px 6px;
  font-size: 0.75rem;
  color: white;
}
```

### For Connections Features
1. Edit `/static/css/connections.css`
2. Add styles for connection cards, lists, or grids

```css
.connection-badge {
  display: inline-block;
  background: var(--success);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
}
```

## CSS Custom Properties Available

From `main.css`:
- `--bg` - Background color
- `--text` - Text color
- `--muted` - Muted/secondary text
- `--border` - Border color
- `--primary` - Primary brand color
- `--primary-600`, `--primary-700` - Brand color variations
- `--success` - Success state color
- `--warning` - Warning state color
- `--error` - Error state color
- `--info` - Info state color
- `--card` - Card background color
- `--shadow` - Default shadow
- `--radius` - Border radius (14px)

## Responsive Design

Currently implemented for messages page:
```css
@media (max-width: 768px) {
  .messages-container {
    grid-template-columns: 1fr;
  }
}
```

Add more breakpoints as needed:
```css
@media (max-width: 768px) { /* Tablet */ }
@media (max-width: 480px) { /* Mobile */ }
@media (min-width: 1024px) { /* Desktop */ }
```

## Common Patterns

### Flex Container
```css
.flex-container {
  display: flex;
  gap: 12px;
  align-items: center;
}
```

### Grid Container
```css
.grid-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
```

### Hover Effect
```css
.interactive-item {
  transition: background-color 0.2s;
}

.interactive-item:hover {
  background-color: var(--border);
}
```

## Dark Mode Support

All colors already support dark mode via CSS custom properties. The browser automatically applies the dark theme from `main.css` when user prefers it.

No additional work needed for dark mode compliance!

## Testing Checklist

When you make CSS changes:
- [ ] Test on desktop (1920px+)
- [ ] Test on tablet (768px)
- [ ] Test on mobile (375px)
- [ ] Test light theme
- [ ] Test dark theme (prefers-color-scheme)
- [ ] Check for layout shifts or overflow
- [ ] Verify accessibility (color contrast, focus states)

## Common Issues & Solutions

### Issue: Styles not appearing
**Solution:** Make sure template has `{% load static %}` and correct `<link>` tag in `head_extra` block

### Issue: Responsive design breaking
**Solution:** Check media query breakpoints; add necessary breakpoints for new layouts

### Issue: Colors not matching design
**Solution:** Use CSS custom properties from `main.css` instead of hardcoding colors

### Issue: Inconsistent spacing
**Solution:** Use multiples of 4px (4px, 8px, 12px, 16px, 24px, etc.)

## Performance Tips

1. ✅ CSS is now modular - only load what's needed per page
2. ✅ CSS custom properties reduce code duplication
3. ✅ Classes are reusable across templates
4. ✅ No inline styles means better caching

## Future Optimization

Consider these improvements:
- Minify CSS in production
- Use CSS Grid for complex layouts
- Create utility classes for spacing (margin, padding)
- Set up SCSS if nesting becomes necessary
- Implement CSS-in-JS for dynamic styling if needed
