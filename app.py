"""
EHE Census Interactive Dashboard
Explore Elective Home Education data for England with focus on South West region
and Cornwall, Plymouth, Devon local authorities.
"""

import os
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from dash import Dash, html, dcc, callback, Output, Input, State
import dash_bootstrap_components as dbc

# =============================================================================
# DATA LOADING AND PREPROCESSING
# =============================================================================

def load_and_prepare_data():
    """Load and preprocess the EHE census data."""
    # Use path relative to this script's location (works locally and deployed)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(script_dir, 'ehe_census.csv')
    df = pd.read_csv(csv_path)

    # Convert time_period to readable format (202223 -> 2022/23)
    df['academic_year'] = df['time_period'].apply(
        lambda x: f"20{str(x)[2:4]}/{str(x)[4:6]}"
    )

    # Create numeric year for sorting (202223 -> 2022)
    df['year_start'] = df['time_period'].apply(lambda x: int(f"20{str(x)[2:4]}"))

    # Create term order for proper sequencing (Autumn=1, Spring=2, Summer=3)
    term_order = {'Autumn term': 1, 'Spring term': 2, 'Summer term': 3}
    df['term_order'] = df['time_identifier'].map(term_order)

    # Create combined year-term for x-axis (e.g., "2022/23 Autumn")
    df['term_short'] = df['time_identifier'].str.replace(' term', '')
    df['year_term'] = df['academic_year'] + ' ' + df['term_short']

    # Create sort key for proper chronological ordering
    df['sort_key'] = df['year_start'] * 10 + df['term_order']

    # Convert child_count to numeric (handle 'low', 'x', etc.)
    df['child_count_numeric'] = pd.to_numeric(df['child_count'], errors='coerce')

    # Convert child_percent to numeric
    df['child_percent_numeric'] = pd.to_numeric(df['child_percent'], errors='coerce')

    # Convert rate to numeric
    df['rate_numeric'] = pd.to_numeric(df['rate_per_100'], errors='coerce')

    # Flag South West region
    df['is_south_west'] = df['region_name'] == 'South West'

    # Flag key LAs
    df['is_key_la'] = df['la_name'].isin(['Cornwall', 'Plymouth', 'Devon'])

    return df

# Load data globally
print("Loading data...")
df = load_and_prepare_data()
print(f"Loaded {len(df):,} rows")

# Get unique values for filters
time_periods = sorted(df['academic_year'].unique())
regions = [r for r in df['region_name'].unique() if pd.notna(r) and r != '']
local_authorities = sorted([la for la in df['la_name'].unique() if pd.notna(la) and la != ''])
breakdown_topics = df['breakdown_topic'].unique().tolist()

# Create chronologically ordered list of year_term values for x-axis
year_term_order = df.sort_values('sort_key')['year_term'].unique().tolist()
print(f"Time sequence: {year_term_order}")

# Key South West LAs
SW_LOCAL_AUTHORITIES = sorted([
    la for la in df[df['region_name'] == 'South West']['la_name'].unique()
    if pd.notna(la) and la != ''
])

# Fixed color mapping for EHE reasons (consistent across all charts)
REASON_COLORS = {
    'Unknown': '#E94F37',  # Red - stands out as data quality issue
    'No reason given': '#FF6B6B',  # Light red
    'Mental health': '#2E86AB',  # Blue
    'Physical health': '#5DA9E9',  # Light blue
    'Health concerns related to COVID19': '#89CFF0',  # Pale blue
    'School dissatisfaction general': '#F6AE2D',  # Orange
    'School dissatisfaction SEND': '#F4D35E',  # Yellow
    'School dissatisfaction bullying': '#FAA307',  # Dark orange
    'Lifestyle': '#4CAF50',  # Green
    'Philosophical or preferential': '#81C784',  # Light green
    'Religious': '#A5D6A7',  # Pale green
    'Risk of school exclusion': '#9C27B0',  # Purple
    'Permanent exclusion': '#BA68C8',  # Light purple
    'Did not get school preference': '#7E57C2',  # Violet
    'Difficulty accessing suitable school place': '#5C6BC0',  # Indigo
    'Offered school place but not yet accepted': '#42A5F5',  # Sky blue
    'Did not apply for school place at compulsory school age': '#26A69A',  # Teal
    'School suggestion': '#78909C',  # Blue grey
    'Other': '#8D6E63',  # Brown
}

# Fixed order for year groups (Reception through Year 11)
YEAR_GROUP_ORDER = ['Reception'] + [f'Year {i}' for i in range(1, 12)]

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_national_totals(year=None):
    """Get national total figures."""
    mask = (df['geographic_level'] == 'National') & (df['breakdown'] == 'Total')
    if year:
        mask &= (df['academic_year'] == year)
    return df[mask]

def get_regional_totals(year=None):
    """Get regional total figures."""
    mask = (df['geographic_level'] == 'Regional') & (df['breakdown'] == 'Total')
    if year:
        mask &= (df['academic_year'] == year)
    return df[mask]

def get_la_totals(year=None, region=None):
    """Get local authority total figures."""
    mask = (df['geographic_level'] == 'Local authority') & (df['breakdown'] == 'Total')
    if year:
        mask &= (df['academic_year'] == year)
    if region:
        mask &= (df['region_name'] == region)
    return df[mask]

def format_number(n):
    """Format number with commas."""
    if pd.isna(n):
        return "N/A"
    return f"{int(n):,}"

def calculate_change(current, previous):
    """Calculate percentage change."""
    if pd.isna(current) or pd.isna(previous) or previous == 0:
        return None
    return ((current - previous) / previous) * 100

# =============================================================================
# CHART BUILDERS
# =============================================================================

def build_national_trend_chart():
    """Build national trend bar chart with terms differentiated."""
    data = get_national_totals()
    data = data.sort_values('sort_key')

    # Define term colors
    term_colors = {'Autumn': '#E94F37', 'Spring': '#2E86AB', 'Summer': '#4CAF50'}

    fig = px.bar(
        data, x='year_term', y='child_count_numeric',
        color='term_short',
        color_discrete_map=term_colors,
        title='National EHE Children Over Time',
        hover_data={'academic_year': True, 'time_identifier': True},
        category_orders={'year_term': year_term_order}
    )

    fig.update_layout(
        xaxis_title='Academic Year & Term',
        yaxis_title='Number of Children',
        legend_title='Term',
        xaxis_tickangle=-45,
        hovermode='closest',
        xaxis={'categoryorder': 'array', 'categoryarray': year_term_order}
    )
    return fig

def build_regional_comparison_chart(year, highlight_region='South West'):
    """Build regional comparison bar chart."""
    data = get_regional_totals(year)
    data = data.sort_values('child_count_numeric', ascending=True)

    colors = ['#2E86AB' if r != highlight_region else '#E94F37'
              for r in data['region_name']]

    fig = px.bar(
        data, x='child_count_numeric', y='region_name',
        orientation='h',
        title=f'EHE Children by Region ({year})'
    )
    fig.update_traces(marker_color=colors)
    fig.update_layout(
        xaxis_title='Number of Children',
        yaxis_title='',
        showlegend=False
    )
    return fig

def build_regional_rate_chart(year, highlight_region='South West'):
    """Build regional rate comparison chart."""
    data = get_regional_totals(year)
    data = data.sort_values('rate_numeric', ascending=True)

    colors = ['#2E86AB' if r != highlight_region else '#E94F37'
              for r in data['region_name']]

    fig = px.bar(
        data, x='rate_numeric', y='region_name',
        orientation='h',
        title=f'EHE Rate per 100 Pupils by Region ({year})'
    )
    fig.update_traces(marker_color=colors)
    fig.update_layout(
        xaxis_title='Rate per 100 Pupils',
        yaxis_title='',
        showlegend=False
    )
    return fig

def build_regional_trends_chart(regions_to_show):
    """Build multi-region trend comparison with bars grouped by term."""
    data = get_regional_totals()
    data = data[data['region_name'].isin(regions_to_show)]
    data = data.sort_values('sort_key')

    fig = px.bar(
        data, x='year_term', y='child_count_numeric',
        color='region_name',
        barmode='group',
        title='Regional Trends Over Time',
        hover_data={'academic_year': True, 'time_identifier': True},
        category_orders={'year_term': year_term_order}
    )
    fig.update_layout(
        xaxis_title='Academic Year & Term',
        yaxis_title='Number of Children',
        legend_title='Region',
        xaxis_tickangle=-45,
        hovermode='closest',
        xaxis={'categoryorder': 'array', 'categoryarray': year_term_order}
    )
    return fig

def build_la_comparison_chart(year, las_to_show, metric='child_count_numeric'):
    """Build LA comparison bar chart."""
    data = get_la_totals(year)
    data = data[data['la_name'].isin(las_to_show)]
    data = data.sort_values(metric, ascending=True)

    # Color key LAs differently
    colors = ['#E94F37' if la in ['Cornwall', 'Plymouth', 'Devon'] else '#2E86AB'
              for la in data['la_name']]

    metric_label = 'Number of Children' if metric == 'child_count_numeric' else 'Rate per 100 Pupils'

    fig = px.bar(
        data, x=metric, y='la_name',
        orientation='h',
        title=f'Local Authorities Comparison ({year})'
    )
    fig.update_traces(marker_color=colors)
    fig.update_layout(
        xaxis_title=metric_label,
        yaxis_title='',
        showlegend=False
    )
    return fig

def build_la_trends_chart(las_to_show):
    """Build LA trends over time with bars grouped by LA."""
    data = get_la_totals()
    data = data[data['la_name'].isin(las_to_show)]
    data = data.sort_values('sort_key')

    fig = px.bar(
        data, x='year_term', y='child_count_numeric',
        color='la_name',
        barmode='group',
        title='Local Authority Trends Over Time',
        hover_data={'academic_year': True, 'time_identifier': True},
        category_orders={'year_term': year_term_order}
    )
    fig.update_layout(
        xaxis_title='Academic Year & Term',
        yaxis_title='Number of Children',
        legend_title='Local Authority',
        xaxis_tickangle=-45,
        hovermode='closest',
        xaxis={'categoryorder': 'array', 'categoryarray': year_term_order}
    )
    return fig

def build_reasons_chart(year, geo_level='National', geo_name=None):
    """Build reasons breakdown chart."""
    mask = (df['breakdown_topic'] == 'Reason') & (df['academic_year'] == year)

    if geo_level == 'National':
        mask &= (df['geographic_level'] == 'National')
    elif geo_level == 'Regional':
        mask &= (df['geographic_level'] == 'Regional') & (df['region_name'] == geo_name)
    elif geo_level == 'Local authority':
        mask &= (df['geographic_level'] == 'Local authority') & (df['la_name'] == geo_name)

    data = df[mask].copy()
    data = data[data['child_percent_numeric'].notna()]
    data = data.sort_values('child_percent_numeric', ascending=True)

    title = f'Reasons for Home Education ({year})'
    if geo_name:
        title += f' - {geo_name}'

    # Get colors for each reason
    colors = [REASON_COLORS.get(reason, '#999999') for reason in data['breakdown']]

    fig = px.bar(
        data, x='child_percent_numeric', y='breakdown',
        orientation='h',
        title=title
    )
    fig.update_traces(marker_color=colors)
    fig.update_layout(
        xaxis_title='Percentage of EHE Children',
        yaxis_title='',
        showlegend=False
    )
    return fig

def build_year_group_chart(year, geo_level='National', geo_name=None):
    """Build year group distribution chart."""
    mask = (df['breakdown_topic'] == 'Year group') & (df['academic_year'] == year)

    if geo_level == 'National':
        mask &= (df['geographic_level'] == 'National')
    elif geo_level == 'Regional':
        mask &= (df['geographic_level'] == 'Regional') & (df['region_name'] == geo_name)
    elif geo_level == 'Local authority':
        mask &= (df['geographic_level'] == 'Local authority') & (df['la_name'] == geo_name)

    data = df[mask].copy()
    data = data[~data['breakdown'].isin(['Unknown', 'Total'])]
    data = data[data['child_percent_numeric'].notna()]

    # Sort by year group order
    year_order = ['Reception'] + [f'Year {i}' for i in range(1, 12)]
    data['sort_order'] = data['breakdown'].apply(lambda x: year_order.index(x) if x in year_order else 99)
    data = data.sort_values('sort_order')

    title = f'EHE by Year Group ({year})'
    if geo_name:
        title += f' - {geo_name}'

    fig = px.bar(
        data, x='breakdown', y='child_percent_numeric',
        title=title,
        category_orders={'breakdown': YEAR_GROUP_ORDER}
    )
    fig.update_traces(marker_color='#2E86AB')
    fig.update_layout(
        xaxis_title='Year Group',
        yaxis_title='Percentage',
        showlegend=False,
        xaxis={'categoryorder': 'array', 'categoryarray': YEAR_GROUP_ORDER}
    )
    return fig

def build_sex_distribution_chart(year, geo_level='National', geo_name=None):
    """Build sex distribution pie chart."""
    mask = (df['breakdown_topic'] == 'Sex') & (df['academic_year'] == year)

    if geo_level == 'National':
        mask &= (df['geographic_level'] == 'National')
    elif geo_level == 'Regional':
        mask &= (df['geographic_level'] == 'Regional') & (df['region_name'] == geo_name)
    elif geo_level == 'Local authority':
        mask &= (df['geographic_level'] == 'Local authority') & (df['la_name'] == geo_name)

    data = df[mask].copy()
    data = data[data['breakdown'] != 'Unknown']
    data = data[data['child_count_numeric'].notna()]

    title = f'Sex Distribution ({year})'
    if geo_name:
        title += f' - {geo_name}'

    fig = px.pie(
        data, values='child_count_numeric', names='breakdown',
        title=title,
        color_discrete_sequence=['#E94F37', '#2E86AB']
    )
    return fig

def build_reasons_comparison_chart(year, regions_or_las, geo_level='Regional'):
    """Compare reasons across regions or LAs using pie charts."""
    mask = (df['breakdown_topic'] == 'Reason') & (df['academic_year'] == year)

    if geo_level == 'Regional':
        mask &= (df['geographic_level'] == 'Regional') & (df['region_name'].isin(regions_or_las))
        group_col = 'region_name'
    else:
        mask &= (df['geographic_level'] == 'Local authority') & (df['la_name'].isin(regions_or_las))
        group_col = 'la_name'

    data = df[mask].copy()
    data = data[data['child_percent_numeric'].notna()]

    # Get the list of areas to show
    areas = [a for a in regions_or_las if a in data[group_col].unique()]

    if len(areas) == 0:
        # Return empty figure if no data
        fig = go.Figure()
        fig.update_layout(title="No data available")
        return fig

    # Create subplots - one pie per area
    n_cols = min(3, len(areas))
    n_rows = (len(areas) + n_cols - 1) // n_cols

    fig = make_subplots(
        rows=n_rows, cols=n_cols,
        specs=[[{'type': 'pie'} for _ in range(n_cols)] for _ in range(n_rows)],
        subplot_titles=areas
    )

    # Get all unique reasons across all areas for consistent ordering
    all_reasons = data['breakdown'].unique().tolist()

    for i, area in enumerate(areas):
        area_data = data[data[group_col] == area]
        row = i // n_cols + 1
        col = i % n_cols + 1

        # Get colors for each reason in this area's data
        colors = [REASON_COLORS.get(reason, '#999999') for reason in area_data['breakdown']]

        fig.add_trace(
            go.Pie(
                labels=area_data['breakdown'],
                values=area_data['child_percent_numeric'],
                name=area,
                textinfo='percent',
                textposition='inside',
                marker=dict(colors=colors),
                showlegend=(i == 0),  # Only show legend for first pie
                sort=False  # Keep consistent order
            ),
            row=row, col=col
        )

    fig.update_layout(
        title=f'Reasons for Home Education by Area ({year})',
        height=300 * n_rows,
        showlegend=True,
        legend_title='Reason'
    )
    return fig

# =============================================================================
# DASH APP LAYOUT
# =============================================================================

app = Dash(__name__, external_stylesheets=[dbc.themes.FLATLY])
app.title = "EHE Census Dashboard"

# Latest year for defaults
latest_year = time_periods[-1]

# Custom CSS for professional styling
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

# Header
header = dbc.Row([
    dbc.Col([
        html.Div([
            html.H1("EHE Census Dashboard",
                   style={'color': 'white', 'marginBottom': '5px', 'fontWeight': '600'}),
            html.P("Elective Home Education Data for England",
                  style={'color': 'rgba(255,255,255,0.8)', 'marginBottom': '0', 'fontSize': '1.1rem'})
        ])
    ], width=8),
    dbc.Col([
        html.Div([
            html.P("Data Source: DfE EHE Census",
                  style={'color': 'rgba(255,255,255,0.7)', 'marginBottom': '0', 'fontSize': '0.85rem', 'textAlign': 'right'}),
            html.P(f"Latest: {latest_year}",
                  style={'color': 'rgba(255,255,255,0.9)', 'marginBottom': '0', 'fontSize': '0.95rem', 'textAlign': 'right', 'fontWeight': '500'})
        ])
    ], width=4, className="d-flex align-items-center justify-content-end"),
], style=CUSTOM_STYLE['header'])

# Sidebar
sidebar = html.Div([
    html.H5("Filters", style={'fontWeight': '600', 'marginBottom': '20px', 'color': '#2c3e50'}),

    html.Label("Academic Year", style=CUSTOM_STYLE['filter_label']),
    dcc.Dropdown(
        id='year-selector',
        options=[{'label': y, 'value': y} for y in time_periods],
        value=latest_year,
        clearable=False,
        style={'marginBottom': '20px'}
    ),

    html.Label("Compare Region", style=CUSTOM_STYLE['filter_label']),
    dcc.Dropdown(
        id='region-selector',
        options=[{'label': r, 'value': r} for r in regions],
        value='South West',
        clearable=False,
        style={'marginBottom': '20px'}
    ),

    html.Label("Key Local Authorities", style=CUSTOM_STYLE['filter_label']),
    dcc.Checklist(
        id='key-la-selector',
        options=[
            {'label': ' Cornwall', 'value': 'Cornwall'},
            {'label': ' Plymouth', 'value': 'Plymouth'},
            {'label': ' Devon', 'value': 'Devon'},
        ],
        value=['Cornwall', 'Plymouth', 'Devon'],
        inline=False,
        style={'marginTop': '5px'},
        labelStyle={'display': 'block', 'marginBottom': '8px', 'cursor': 'pointer'}
    ),
], style=CUSTOM_STYLE['sidebar'])

# KPI Card component
def make_kpi_card(body_id, header_text, color='primary', header_id=None):
    color_map = {
        'primary': '#3498db',
        'success': '#18bc9c',
        'warning': '#f39c12',
        'info': '#2c3e50'
    }
    header_props = {
        'style': {'color': '#6c757d', 'fontSize': '0.8rem', 'marginBottom': '5px',
                  'textTransform': 'uppercase', 'letterSpacing': '0.5px', 'fontWeight': '500'}
    }
    if header_id:
        header_props['id'] = header_id

    return dbc.Card([
        dbc.CardBody([
            html.P(header_text, **header_props),
            html.Div(id=body_id)
        ])
    ], style={**CUSTOM_STYLE['kpi_card'], 'borderTop': f'4px solid {color_map.get(color, color_map["primary"])}'})

# Overview Tab
overview_tab = dbc.Tab(label="Overview", tab_id="overview", children=[
    dbc.Row([
        dbc.Col([make_kpi_card('national-total-card', 'National Total', 'primary')], width=3),
        dbc.Col([make_kpi_card('yoy-change-card', 'Year-on-Year Change', 'success')], width=3),
        dbc.Col([make_kpi_card('rate-card', 'Rate per 100 Pupils', 'info')], width=3),
        dbc.Col([make_kpi_card('region-total-card', '', 'warning', 'region-total-header')], width=3),
    ], className="mb-4 g-3"),
    dbc.Row([
        dbc.Col([
            dbc.Card([
                dbc.CardBody([dcc.Graph(id='national-trend-chart')])
            ], style={'borderRadius': '8px', 'border': 'none', 'boxShadow': '0 2px 8px rgba(0,0,0,0.08)'})
        ], width=6),
        dbc.Col([
            dbc.Card([
                dbc.CardBody([dcc.Graph(id='regional-comparison-chart')])
            ], style={'borderRadius': '8px', 'border': 'none', 'boxShadow': '0 2px 8px rgba(0,0,0,0.08)'})
        ], width=6),
    ], className="g-3"),
])

# Regional Comparison Tab
regional_tab = dbc.Tab(label="Regional Comparison", children=[
    dbc.Row([
        dbc.Col([
            html.Label("Select Regions to Compare"),
            dcc.Dropdown(
                id='regions-multi-selector',
                options=[{'label': r, 'value': r} for r in regions],
                value=['South West', 'South East', 'East of England', 'North West'],
                multi=True
            ),
        ], width=12),
    ], className="mb-3"),
    dbc.Row([
        dbc.Col([
            dcc.Graph(id='regional-trends-chart')
        ], width=6),
        dbc.Col([
            dcc.Graph(id='regional-rate-chart')
        ], width=6),
    ]),
    dbc.Row([
        dbc.Col([
            dcc.Graph(id='regional-reasons-chart')
        ], width=6),
        dbc.Col([
            dcc.Graph(id='regional-yeargroup-chart')
        ], width=6),
    ]),
])

# Local Authority Tab
la_tab = dbc.Tab(label="Local Authorities", children=[
    dbc.Row([
        dbc.Col([
            html.Label("Filter by Region"),
            dcc.Dropdown(
                id='la-region-filter',
                options=[{'label': 'All Regions', 'value': 'All'}] +
                        [{'label': r, 'value': r} for r in regions],
                value='South West',
                clearable=False
            ),
        ], width=4),
        dbc.Col([
            html.Label("Select Local Authorities"),
            dcc.Dropdown(
                id='la-multi-selector',
                options=[{'label': la, 'value': la} for la in local_authorities],
                value=['Cornwall', 'Plymouth', 'Devon', 'Somerset', 'Dorset'],
                multi=True
            ),
        ], width=8),
    ], className="mb-3"),
    dbc.Row([
        dbc.Col([
            html.Label("Metric"),
            dcc.RadioItems(
                id='la-metric-selector',
                options=[
                    {'label': ' Number of Children', 'value': 'child_count_numeric'},
                    {'label': ' Rate per 100 Pupils', 'value': 'rate_numeric'},
                ],
                value='child_count_numeric',
                inline=True
            ),
        ], width=12),
    ], className="mb-3"),
    dbc.Row([
        dbc.Col([
            dcc.Graph(id='la-comparison-chart')
        ], width=6),
        dbc.Col([
            dcc.Graph(id='la-trends-chart')
        ], width=6),
    ]),
    dbc.Row([
        dbc.Col([
            dcc.Graph(id='la-reasons-comparison-chart')
        ], width=12),
    ]),
])

# Time Series Tab
time_tab = dbc.Tab(label="Time Analysis", children=[
    dbc.Row([
        dbc.Col([
            html.Label("Geography Level"),
            dcc.RadioItems(
                id='time-geo-level',
                options=[
                    {'label': ' National', 'value': 'National'},
                    {'label': ' Regional', 'value': 'Regional'},
                    {'label': ' Local Authority', 'value': 'Local authority'},
                ],
                value='National',
                inline=True
            ),
        ], width=4),
        dbc.Col([
            html.Label("Select Geography"),
            dcc.Dropdown(
                id='time-geo-selector',
                options=[],
                value=None,
                disabled=True
            ),
        ], width=4),
        dbc.Col([
            html.Label("Breakdown"),
            dcc.Dropdown(
                id='time-breakdown-selector',
                options=[
                    {'label': 'Total', 'value': 'Total'},
                    {'label': 'By Sex', 'value': 'Sex'},
                    {'label': 'By Year Group', 'value': 'Year group'},
                    {'label': 'By Reason', 'value': 'Reason'},
                ],
                value='Total',
                clearable=False
            ),
        ], width=4),
    ], className="mb-3"),
    dbc.Row([
        dbc.Col([
            dcc.Graph(id='time-series-chart')
        ], width=12),
    ]),
    dbc.Row([
        dbc.Col([
            dcc.Graph(id='time-growth-chart')
        ], width=6),
        dbc.Col([
            dcc.Graph(id='time-comparison-table')
        ], width=6),
    ]),
])

# Demographics Tab
demo_tab = dbc.Tab(label="Demographics & Reasons", children=[
    dbc.Row([
        dbc.Col([
            html.Label("Geography Level"),
            dcc.RadioItems(
                id='demo-geo-level',
                options=[
                    {'label': ' National', 'value': 'National'},
                    {'label': ' Regional', 'value': 'Regional'},
                    {'label': ' Local Authority', 'value': 'Local authority'},
                ],
                value='National',
                inline=True
            ),
        ], width=4),
        dbc.Col([
            html.Label("Select Geography"),
            dcc.Dropdown(
                id='demo-geo-selector',
                options=[],
                value=None,
                disabled=True
            ),
        ], width=8),
    ], className="mb-3"),
    dbc.Row([
        dbc.Col([
            dcc.Graph(id='demo-reasons-chart')
        ], width=8),
        dbc.Col([
            dcc.Graph(id='demo-sex-chart')
        ], width=4),
    ]),
    dbc.Row([
        dbc.Col([
            dcc.Graph(id='demo-yeargroup-chart')
        ], width=12),
    ]),
])

# Data Explorer Tab
explorer_tab = dbc.Tab(label="Data Explorer", children=[
    dbc.Row([
        dbc.Col([
            html.Label("Geographic Level"),
            dcc.Dropdown(
                id='explorer-geo-level',
                options=[
                    {'label': 'National', 'value': 'National'},
                    {'label': 'Regional', 'value': 'Regional'},
                    {'label': 'Local Authority', 'value': 'Local authority'},
                ],
                value='Regional',
                clearable=False
            ),
        ], width=3),
        dbc.Col([
            html.Label("Breakdown Topic"),
            dcc.Dropdown(
                id='explorer-breakdown',
                options=[{'label': b, 'value': b} for b in breakdown_topics],
                value='Total',
                clearable=False
            ),
        ], width=3),
        dbc.Col([
            html.Label("Year"),
            dcc.Dropdown(
                id='explorer-year',
                options=[{'label': y, 'value': y} for y in time_periods],
                value=latest_year,
                clearable=False
            ),
        ], width=3),
        dbc.Col([
            html.Br(),
            dbc.Button("Download CSV", id='download-btn', color="primary"),
            dcc.Download(id='download-data')
        ], width=3),
    ], className="mb-3"),
    dbc.Row([
        dbc.Col([
            html.Div(id='data-table-container')
        ], width=12),
    ]),
])

# Main Layout
app.layout = html.Div([
    # Header
    header,

    # Main content
    dbc.Container([
        dbc.Row([
            dbc.Col([sidebar], width=2),
            dbc.Col([
                dbc.Card([
                    dbc.CardBody([
                        dbc.Tabs([
                            overview_tab,
                            regional_tab,
                            la_tab,
                            time_tab,
                            demo_tab,
                            explorer_tab,
                        ], className="nav-pills")
                    ])
                ], style={'borderRadius': '8px', 'border': 'none', 'boxShadow': '0 2px 8px rgba(0,0,0,0.08)'})
            ], width=10),
        ], className="g-3"),

        # Footer
        dbc.Row([
            dbc.Col([
                html.Hr(style={'marginTop': '30px'}),
                html.P([
                    "EHE Census Dashboard | Data: ",
                    html.A("Explore Education Statistics (DfE)",
                           href="https://explore-education-statistics.service.gov.uk/find-statistics/elective-home-education/2025-26-autumn-term",
                           target="_blank",
                           style={'color': '#3498db'})
                ], style={'textAlign': 'center', 'color': '#6c757d', 'fontSize': '0.85rem'})
            ])
        ], className="mt-4")
    ], fluid=True, style={'padding': '0 20px'})
], style={'backgroundColor': '#f0f2f5', 'minHeight': '100vh'})

# =============================================================================
# CALLBACKS
# =============================================================================

# Overview Tab Callbacks
@callback(
    [Output('national-total-card', 'children'),
     Output('yoy-change-card', 'children'),
     Output('rate-card', 'children'),
     Output('region-total-header', 'children'),
     Output('region-total-card', 'children')],
    [Input('year-selector', 'value'),
     Input('region-selector', 'value')]
)
def update_kpi_cards(year, selected_region):
    # National total
    nat_data = get_national_totals(year)
    nat_total = nat_data['child_count_numeric'].iloc[0] if len(nat_data) > 0 else None
    nat_rate = nat_data['rate_numeric'].iloc[0] if len(nat_data) > 0 else None

    # Previous year for YoY
    year_idx = time_periods.index(year)
    if year_idx > 0:
        prev_year = time_periods[year_idx - 1]
        prev_data = get_national_totals(prev_year)
        prev_total = prev_data['child_count_numeric'].iloc[0] if len(prev_data) > 0 else None
        yoy = calculate_change(nat_total, prev_total)
    else:
        yoy = None

    # Selected region total
    region_data = get_regional_totals(year)
    region_data = region_data[region_data['region_name'] == selected_region]
    region_total = region_data['child_count_numeric'].iloc[0] if len(region_data) > 0 else None

    return (
        html.H3(format_number(nat_total), className="text-primary"),
        html.H3(f"{yoy:+.1f}%" if yoy else "N/A",
                className="text-success" if yoy and yoy > 0 else "text-danger"),
        html.H3(f"{nat_rate:.2f}" if nat_rate else "N/A", className="text-info"),
        f"{selected_region} Total",
        html.H3(format_number(region_total), className="text-warning"),
    )

@callback(
    Output('national-trend-chart', 'figure'),
    Input('year-selector', 'value')
)
def update_national_trend(year):
    return build_national_trend_chart()

@callback(
    Output('regional-comparison-chart', 'figure'),
    [Input('year-selector', 'value'),
     Input('region-selector', 'value')]
)
def update_regional_comparison(year, region):
    return build_regional_rate_chart(year, region)

# Regional Tab Callbacks
@callback(
    Output('regional-trends-chart', 'figure'),
    Input('regions-multi-selector', 'value')
)
def update_regional_trends(regions_list):
    if not regions_list:
        regions_list = ['South West']
    return build_regional_trends_chart(regions_list)

@callback(
    Output('regional-rate-chart', 'figure'),
    [Input('year-selector', 'value'),
     Input('region-selector', 'value')]
)
def update_regional_rate(year, region):
    return build_regional_rate_chart(year, region)

@callback(
    Output('regional-reasons-chart', 'figure'),
    [Input('year-selector', 'value'),
     Input('region-selector', 'value')]
)
def update_regional_reasons(year, region):
    return build_reasons_chart(year, 'Regional', region)

@callback(
    Output('regional-yeargroup-chart', 'figure'),
    [Input('year-selector', 'value'),
     Input('region-selector', 'value')]
)
def update_regional_yeargroup(year, region):
    return build_year_group_chart(year, 'Regional', region)

# LA Tab Callbacks
@callback(
    Output('la-multi-selector', 'options'),
    Input('la-region-filter', 'value')
)
def update_la_options(region):
    if region == 'All':
        las = local_authorities
    else:
        las = sorted([
            la for la in df[df['region_name'] == region]['la_name'].unique()
            if pd.notna(la) and la != ''
        ])
    return [{'label': la, 'value': la} for la in las]

@callback(
    Output('la-comparison-chart', 'figure'),
    [Input('year-selector', 'value'),
     Input('la-multi-selector', 'value'),
     Input('la-metric-selector', 'value')]
)
def update_la_comparison(year, las, metric):
    if not las:
        las = ['Cornwall', 'Plymouth', 'Devon']
    return build_la_comparison_chart(year, las, metric)

@callback(
    Output('la-trends-chart', 'figure'),
    Input('la-multi-selector', 'value')
)
def update_la_trends(las):
    if not las:
        las = ['Cornwall', 'Plymouth', 'Devon']
    return build_la_trends_chart(las)

@callback(
    Output('la-reasons-comparison-chart', 'figure'),
    [Input('year-selector', 'value'),
     Input('la-multi-selector', 'value')]
)
def update_la_reasons_comparison(year, las):
    if not las or len(las) < 2:
        las = ['Cornwall', 'Plymouth', 'Devon']
    return build_reasons_comparison_chart(year, las, 'Local authority')

# Time Tab Callbacks
@callback(
    [Output('time-geo-selector', 'options'),
     Output('time-geo-selector', 'value'),
     Output('time-geo-selector', 'disabled')],
    Input('time-geo-level', 'value')
)
def update_time_geo_options(geo_level):
    if geo_level == 'National':
        return [], None, True
    elif geo_level == 'Regional':
        return [{'label': r, 'value': r} for r in regions], 'South West', False
    else:
        return [{'label': la, 'value': la} for la in local_authorities], 'Cornwall', False

@callback(
    Output('time-series-chart', 'figure'),
    [Input('time-geo-level', 'value'),
     Input('time-geo-selector', 'value'),
     Input('time-breakdown-selector', 'value')]
)
def update_time_series(geo_level, geo_name, breakdown):
    mask = (df['geographic_level'] == geo_level)

    if geo_level == 'Regional' and geo_name:
        mask &= (df['region_name'] == geo_name)
    elif geo_level == 'Local authority' and geo_name:
        mask &= (df['la_name'] == geo_name)

    # Term colors and symbols
    term_colors = {'Autumn': '#E94F37', 'Spring': '#2E86AB', 'Summer': '#4CAF50'}
    term_symbols = {'Autumn': 'circle', 'Spring': 'square', 'Summer': 'diamond'}

    if breakdown == 'Total':
        mask &= (df['breakdown'] == 'Total')
        data = df[mask].sort_values('sort_key')

        fig = px.bar(
            data, x='year_term', y='child_count_numeric',
            color='term_short',
            color_discrete_map=term_colors,
            title=f'EHE Children Over Time - {geo_name or "National"}',
            hover_data={'academic_year': True, 'time_identifier': True},
            category_orders={'year_term': year_term_order}
        )
        fig.update_layout(
            xaxis_title='Academic Year & Term',
            yaxis_title='Number of Children',
            legend_title='Term',
            xaxis_tickangle=-45,
            xaxis={'categoryorder': 'array', 'categoryarray': year_term_order}
        )
    else:
        mask &= (df['breakdown_topic'] == breakdown)
        data = df[mask].copy()
        data = data[~data['breakdown'].isin(['Unknown', 'Total'])]
        data = data[data['child_count_numeric'].notna()]
        data = data.sort_values('sort_key')

        # Set category orders based on breakdown type
        cat_orders = {'year_term': year_term_order}
        if breakdown == 'Year group':
            cat_orders['breakdown'] = YEAR_GROUP_ORDER
        elif breakdown == 'Reason':
            cat_orders['breakdown'] = list(REASON_COLORS.keys())

        fig = px.bar(
            data, x='year_term', y='child_count_numeric',
            color='breakdown',
            barmode='group',
            hover_data={'academic_year': True, 'time_identifier': True},
            category_orders=cat_orders
        )
        fig.update_layout(
            title=f'EHE by {breakdown} Over Time - {geo_name or "National"}',
            xaxis_title='Academic Year & Term',
            yaxis_title='Number of Children',
            legend_title=breakdown,
            xaxis_tickangle=-45,
            xaxis={'categoryorder': 'array', 'categoryarray': year_term_order}
        )

    return fig

@callback(
    Output('time-growth-chart', 'figure'),
    [Input('time-geo-level', 'value'),
     Input('time-geo-selector', 'value')]
)
def update_growth_chart(geo_level, geo_name):
    mask = (df['geographic_level'] == geo_level) & (df['breakdown'] == 'Total')

    if geo_level == 'Regional' and geo_name:
        mask &= (df['region_name'] == geo_name)
    elif geo_level == 'Local authority' and geo_name:
        mask &= (df['la_name'] == geo_name)

    data = df[mask].sort_values('sort_key').copy()
    data['growth'] = data['child_count_numeric'].pct_change() * 100

    # Term colors
    term_colors = {'Autumn': '#E94F37', 'Spring': '#2E86AB', 'Summer': '#4CAF50'}

    fig = px.bar(
        data, x='year_term', y='growth',
        color='term_short',
        color_discrete_map=term_colors,
        title=f'Term-on-Term Growth Rate - {geo_name or "National"}',
        category_orders={'year_term': year_term_order}
    )
    fig.update_layout(
        xaxis_title='Academic Year & Term',
        yaxis_title='Growth (%)',
        xaxis_tickangle=-45,
        xaxis={'categoryorder': 'array', 'categoryarray': year_term_order}
    )
    return fig

@callback(
    Output('time-comparison-table', 'figure'),
    [Input('time-geo-level', 'value'),
     Input('time-geo-selector', 'value')]
)
def update_comparison_table(geo_level, geo_name):
    mask = (df['geographic_level'] == geo_level) & (df['breakdown'] == 'Total')

    if geo_level == 'Regional' and geo_name:
        mask &= (df['region_name'] == geo_name)
    elif geo_level == 'Local authority' and geo_name:
        mask &= (df['la_name'] == geo_name)

    data = df[mask].sort_values('year_start')[['academic_year', 'child_count_numeric', 'rate_numeric']].copy()
    data.columns = ['Year', 'Children', 'Rate per 100']

    fig = go.Figure(data=[go.Table(
        header=dict(values=list(data.columns),
                   fill_color='#2E86AB',
                   font=dict(color='white', size=12),
                   align='left'),
        cells=dict(values=[data[col] for col in data.columns],
                  fill_color='lavender',
                  align='left'))
    ])
    fig.update_layout(title=f'Summary Table - {geo_name or "National"}')
    return fig

# Demographics Tab Callbacks
@callback(
    [Output('demo-geo-selector', 'options'),
     Output('demo-geo-selector', 'value'),
     Output('demo-geo-selector', 'disabled')],
    Input('demo-geo-level', 'value')
)
def update_demo_geo_options(geo_level):
    if geo_level == 'National':
        return [], None, True
    elif geo_level == 'Regional':
        return [{'label': r, 'value': r} for r in regions], 'South West', False
    else:
        return [{'label': la, 'value': la} for la in local_authorities], 'Cornwall', False

@callback(
    Output('demo-reasons-chart', 'figure'),
    [Input('year-selector', 'value'),
     Input('demo-geo-level', 'value'),
     Input('demo-geo-selector', 'value')]
)
def update_demo_reasons(year, geo_level, geo_name):
    return build_reasons_chart(year, geo_level, geo_name)

@callback(
    Output('demo-sex-chart', 'figure'),
    [Input('year-selector', 'value'),
     Input('demo-geo-level', 'value'),
     Input('demo-geo-selector', 'value')]
)
def update_demo_sex(year, geo_level, geo_name):
    return build_sex_distribution_chart(year, geo_level, geo_name)

@callback(
    Output('demo-yeargroup-chart', 'figure'),
    [Input('year-selector', 'value'),
     Input('demo-geo-level', 'value'),
     Input('demo-geo-selector', 'value')]
)
def update_demo_yeargroup(year, geo_level, geo_name):
    return build_year_group_chart(year, geo_level, geo_name)

# Data Explorer Callbacks
@callback(
    Output('data-table-container', 'children'),
    [Input('explorer-geo-level', 'value'),
     Input('explorer-breakdown', 'value'),
     Input('explorer-year', 'value')]
)
def update_data_table(geo_level, breakdown, year):
    mask = (df['geographic_level'] == geo_level) & \
           (df['breakdown_topic'] == breakdown) & \
           (df['academic_year'] == year)

    data = df[mask].copy()

    if geo_level == 'National':
        cols = ['breakdown', 'child_count', 'child_percent', 'rate_per_100']
    elif geo_level == 'Regional':
        cols = ['region_name', 'breakdown', 'child_count', 'child_percent', 'rate_per_100']
    else:
        cols = ['region_name', 'la_name', 'breakdown', 'child_count', 'child_percent', 'rate_per_100']

    data = data[cols]

    fig = go.Figure(data=[go.Table(
        header=dict(values=[c.replace('_', ' ').title() for c in data.columns],
                   fill_color='#2E86AB',
                   font=dict(color='white', size=11),
                   align='left'),
        cells=dict(values=[data[col] for col in data.columns],
                  fill_color='white',
                  align='left',
                  height=25))
    ])
    fig.update_layout(height=600, margin=dict(l=0, r=0, t=0, b=0))

    return dcc.Graph(figure=fig)

@callback(
    Output('download-data', 'data'),
    Input('download-btn', 'n_clicks'),
    [State('explorer-geo-level', 'value'),
     State('explorer-breakdown', 'value'),
     State('explorer-year', 'value')],
    prevent_initial_call=True
)
def download_data(n_clicks, geo_level, breakdown, year):
    mask = (df['geographic_level'] == geo_level) & \
           (df['breakdown_topic'] == breakdown) & \
           (df['academic_year'] == year)
    data = df[mask]
    return dcc.send_data_frame(data.to_csv, f"ehe_data_{geo_level}_{breakdown}_{year}.csv", index=False)

# =============================================================================
# RUN APP
# =============================================================================

# Expose the server for Gunicorn (production)
server = app.server

if __name__ == '__main__':
    print("\n" + "="*60)
    print("EHE Census Dashboard")
    print("="*60)
    print(f"Data loaded: {len(df):,} rows")
    print(f"Time periods: {', '.join(time_periods)}")
    print(f"Regions: {len(regions)}")
    print(f"Local Authorities: {len(local_authorities)}")
    print("="*60)

    # Use PORT from environment (Render) or default to 8050 (local)
    port = int(os.environ.get('PORT', 8050))
    debug = os.environ.get('DEBUG', 'True').lower() == 'true'

    print(f"\nStarting server on port {port}...")
    print("="*60 + "\n")

    app.run(debug=debug, host='0.0.0.0', port=port)
