# EHE Census Dashboard - Styling Guide

## Overview

The dashboard uses **Plotly Dash** with **Dash Bootstrap Components** and the **Flatly** theme for a clean, professional appearance.

---

## Theme

```python
app = Dash(__name__, external_stylesheets=[dbc.themes.FLATLY])
```

Flatly provides a clean, flat design with teal/turquoise accent colors.

---

## Custom Styling

### Style Configuration Object

```python
CUSTOM_STYLE = {
    'header': {
        'background': 'linear-gradient(135deg, #2c3e50 0%, #3498db 100%)',
        'padding': '20px 30px',
        'marginBottom': '20px',
        'borderRadius': '0',
        'boxShadow': '0 2px 10px rgba(0,0,0,0.1)'
    },
    'sidebar': {
        'backgroundColor': '#f8f9fa',
        'borderRadius': '8px',
        'padding': '20px',
        'boxShadow': '0 2px 8px rgba(0,0,0,0.08)'
    },
    'kpi_card': {
        'borderRadius': '8px',
        'border': 'none',
        'boxShadow': '0 2px 8px rgba(0,0,0,0.08)',
        'textAlign': 'center',
        'height': '100%'
    },
    'filter_label': {
        'fontWeight': '600',
        'fontSize': '0.85rem',
        'color': '#495057',
        'marginBottom': '8px',
        'textTransform': 'uppercase',
        'letterSpacing': '0.5px'
    }
}
```

---

## Component Styling

### Header Bar

- **Background**: Blue gradient (`#2c3e50` to `#3498db`)
- **Text**: White with varying opacity for hierarchy
- **Shadow**: Subtle drop shadow for depth
- **Content**: Title on left, data source info on right

### Sidebar (Filters)

- **Background**: Light grey (`#f8f9fa`)
- **Border radius**: 8px rounded corners
- **Labels**: Uppercase, small font, letter-spacing for readability
- **Spacing**: Consistent 20px margins between elements

### KPI Cards

- **Color-coded top borders**:
  - Primary (blue `#3498db`): National Total
  - Success (green `#18bc9c`): Year-on-Year Change
  - Info (dark `#2c3e50`): Rate per 100 Pupils
  - Warning (orange `#f39c12`): Regional Total
- **No visible border**, subtle box shadow
- **Centered text** with uppercase labels

### Content Cards

- **Border radius**: 8px
- **No border**: Clean appearance
- **Box shadow**: `0 2px 8px rgba(0,0,0,0.08)`

### Main Background

- **Color**: Light grey (`#f0f2f5`)
- Creates visual separation between components

---

## Chart Color Schemes

### Term Colors (Time Series)

```python
term_colors = {
    'Autumn': '#E94F37',  # Red
    'Spring': '#2E86AB',  # Blue
    'Summer': '#4CAF50'   # Green
}
```

### EHE Reason Colors (Consistent across all charts)

```python
REASON_COLORS = {
    'Unknown': '#E94F37',                    # Red - data quality flag
    'No reason given': '#FF6B6B',            # Light red
    'Mental health': '#2E86AB',              # Blue
    'Physical health': '#5DA9E9',            # Light blue
    'Health concerns related to COVID19': '#89CFF0',  # Pale blue
    'School dissatisfaction general': '#F6AE2D',      # Orange
    'School dissatisfaction SEND': '#F4D35E',         # Yellow
    'School dissatisfaction bullying': '#FAA307',     # Dark orange
    'Lifestyle': '#4CAF50',                  # Green
    'Philosophical or preferential': '#81C784',       # Light green
    'Religious': '#A5D6A7',                  # Pale green
    'Risk of school exclusion': '#9C27B0',   # Purple
    'Permanent exclusion': '#BA68C8',        # Light purple
    'Did not get school preference': '#7E57C2',       # Violet
    'Difficulty accessing suitable school place': '#5C6BC0',  # Indigo
    'School suggestion': '#78909C',          # Blue grey
    'Other': '#8D6E63',                      # Brown
}
```

---

## Layout Structure

```
+----------------------------------------------------------+
|  HEADER (gradient background)                             |
|  Title                              Data Source Info      |
+----------------------------------------------------------+
|         |                                                 |
| SIDEBAR |  CONTENT AREA (tabbed)                         |
| Filters |  +------------------------------------------+   |
|         |  | KPI Cards (4 across)                     |   |
|         |  +------------------------------------------+   |
|         |  | Charts (2 columns)                       |   |
|         |  |                                          |   |
|         |  +------------------------------------------+   |
|         |                                                 |
+----------------------------------------------------------+
|  FOOTER (centered attribution)                            |
+----------------------------------------------------------+
```

---

## Responsive Considerations

- Uses Bootstrap grid system (12 columns)
- Sidebar: 2 columns (width=2)
- Content: 10 columns (width=10)
- KPI cards: 3 columns each (4 cards = 12 columns)
- Charts: 6 columns each (2 per row)

---

## Dependencies

```
dash>=2.14.0
dash-bootstrap-components>=1.5.0
plotly>=5.18.0
pandas>=2.0.0
```

---

## Available Bootstrap Themes

To change the theme, modify the `external_stylesheets` parameter:

```python
# Light themes
dbc.themes.FLATLY      # Current - clean, professional
dbc.themes.BOOTSTRAP   # Default Bootstrap
dbc.themes.MINTY       # Mint green accents
dbc.themes.SANDSTONE   # Warm, earthy tones
dbc.themes.COSMO       # Modern, clean

# Dark themes
dbc.themes.DARKLY      # Dark mode
dbc.themes.CYBORG      # Dark with neon accents
dbc.themes.SLATE       # Dark grey
```
