# Run with: python cluster_viz_app.py
# Then open http://127.0.0.1:8050 in browser

import dash
from dash import dcc, html
from dash.dependencies import Input, Output
import plotly.graph_objects as go
import pandas as pd
import numpy as np
import json

# Load data
complete_data = []
with open('data/data_complete.jsonl', 'r') as f:
    for line in f:
        complete_data.append(json.loads(line))

# Create DataFrame
df = pd.DataFrame({
    'tsne_x': [item['tsne_x'] for item in complete_data],
    'tsne_y': [item['tsne_y'] for item in complete_data],
    'cluster_id': [item['cluster_id'] for item in complete_data],
    'interaction_amount': [item['interaction_amount'] for item in complete_data],
    'title': [item.get('title', 'No title')[:80] for item in complete_data],
    'selftext': [str(item.get('selftext', ''))[:200] for item in complete_data],
    'score': [item.get('score', 0) for item in complete_data],
    'num_comments': [item.get('num_comments', 0) for item in complete_data],
    'subreddit': [item.get('subreddit', 'unknown') for item in complete_data],
    'created_utc': [item.get('created_utc', 0) for item in complete_data]
})

df['datetime'] = pd.to_datetime(df['created_utc'], unit='s', errors='coerce')
max_interaction = df['interaction_amount'].max()
df['size'] = 3 + 25 * np.log1p(df['interaction_amount']) / np.log1p(max_interaction)

# Get filter options
subreddits = ['All'] + sorted(df['subreddit'].unique().tolist())
min_date = df['datetime'].min()
max_date = df['datetime'].max()

# Calculate stats for display
total_posts = len(df)
total_clusters = df['cluster_id'].nunique()
total_subreddits = df['subreddit'].nunique()

# Initialize Dash app with custom styling
app = dash.Dash(__name__)

# Modern light theme CSS
app.index_string = '''
<!DOCTYPE html>
<html>
    <head>
        {%metas%}
        <title>Cluster Explorer</title>
        {%favicon%}
        {%css%}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            body {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                background: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%);
                min-height: 100vh;
            }
            .header {
                background: white;
                border-bottom: 1px solid #e2e8f0;
                box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            }
            .header-content {
                max-width: 1400px;
                margin: 0 auto;
                padding: 24px 40px;
            }
            .header h1 {
                font-size: 28px;
                font-weight: 600;
                color: #1a202c;
                letter-spacing: -0.5px;
            }
            .header p {
                color: #64748b;
                font-size: 14px;
                margin-top: 4px;
            }
            .stats-bar {
                display: flex;
                gap: 32px;
                margin-top: 16px;
            }
            .stat-item {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .stat-value {
                font-size: 20px;
                font-weight: 600;
                color: #084c61;
            }
            .stat-label {
                font-size: 13px;
                color: #64748b;
            }
            .main-container {
                max-width: 1400px;
                margin: 0 auto;
                padding: 24px 40px;
            }
            .filters-card {
                background: white;
                border-radius: 16px;
                padding: 24px;
                margin-bottom: 24px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
            }
            .filters-title {
                font-size: 13px;
                font-weight: 600;
                color: #64748b;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 16px;
            }
            .filters-row {
                display: flex;
                gap: 24px;
                align-items: flex-end;
                flex-wrap: wrap;
            }
            .filter-group {
                flex: 1;
                min-width: 200px;
            }
            .filter-group label {
                display: block;
                font-size: 13px;
                font-weight: 500;
                color: #374151;
                margin-bottom: 8px;
            }
            .chart-card {
                background: white;
                border-radius: 16px;
                padding: 24px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
            }
            /* Custom dropdown styling */
            .Select-control {
                border-radius: 10px !important;
                border: 1px solid #e2e8f0 !important;
                height: 42px !important;
            }
            .Select-control:hover {
                border-color: #56a3a6 !important;
            }
            .is-focused .Select-control {
                border-color: #084c61 !important;
                box-shadow: 0 0 0 3px rgba(8, 76, 97, 0.1) !important;
            }
            /* Date picker styling */
            .DateInput_input {
                border-radius: 10px !important;
                border: 1px solid #e2e8f0 !important;
                padding: 10px 12px !important;
                font-size: 14px !important;
                font-family: 'Inter', sans-serif !important;
            }
            .DateInput_input:focus {
                border-color: #084c61 !important;
            }
            .DateRangePickerInput {
                border-radius: 10px !important;
                border: 1px solid #e2e8f0 !important;
            }
            .CalendarDay__selected {
                background: #084c61 !important;
                border: 1px solid #084c61 !important;
            }
            .CalendarDay__selected_span {
                background: #d4e8eb !important;
                border: 1px solid #a8d4d8 !important;
                color: #084c61 !important;
            }
            .DayPickerKeyboardShortcuts_buttonReset {
                display: none;
            }
        </style>
    </head>
    <body>
        {%app_entry%}
        <footer>
            {%config%}
            {%scripts%}
            {%renderer%}
        </footer>
    </body>
</html>
'''

app.layout = html.Div([
    # Header
    html.Div([
        html.Div([
            html.H1('Cluster Explorer'),
            html.P('Interactive visualization of Reddit posts clustered by topic similarity'),
            html.Div([
                html.Div([
                    html.Span(f'{total_posts:,}', className='stat-value'),
                    html.Span('Posts', className='stat-label')
                ], className='stat-item'),
                html.Div([
                    html.Span(f'{total_clusters}', className='stat-value'),
                    html.Span('Clusters', className='stat-label')
                ], className='stat-item'),
                html.Div([
                    html.Span(f'{total_subreddits}', className='stat-value'),
                    html.Span('Subreddits', className='stat-label')
                ], className='stat-item'),
            ], className='stats-bar')
        ], className='header-content')
    ], className='header'),
    
    # Main content
    html.Div([
        # Filters card
        html.Div([
            html.Div('Filters', className='filters-title'),
            html.Div([
                html.Div([
                    html.Label('Subreddit'),
                    dcc.Dropdown(
                        id='subreddit-filter',
                        options=[{'label': f'r/{s}' if s != 'All' else 'All Subreddits', 'value': s} for s in subreddits],
                        value='All',
                        clearable=False,
                        style={'borderRadius': '10px'}
                    )
                ], className='filter-group'),
                html.Div([
                    html.Label('Date Range'),
                    dcc.DatePickerRange(
                        id='date-filter',
                        min_date_allowed=min_date,
                        max_date_allowed=max_date,
                        start_date=min_date,
                        end_date=max_date,
                        display_format='MMM D, YYYY'
                    )
                ], className='filter-group'),
            ], className='filters-row')
        ], className='filters-card'),
        
        # Chart card
        html.Div([
            dcc.Graph(
                id='cluster-plot',
                style={'height': '700px'},
                config={
                    'displayModeBar': True,
                    'displaylogo': False,
                    'modeBarButtonsToRemove': ['lasso2d', 'select2d']
                }
            )
        ], className='chart-card')
    ], className='main-container')
])

@app.callback(
    Output('cluster-plot', 'figure'),
    [Input('subreddit-filter', 'value'),
     Input('date-filter', 'start_date'),
     Input('date-filter', 'end_date')]
)
def update_plot(subreddit, start_date, end_date):
    filtered_df = df.copy()
    
    if subreddit != 'All':
        filtered_df = filtered_df[filtered_df['subreddit'] == subreddit]
    
    if start_date and end_date:
        filtered_df = filtered_df[
            (filtered_df['datetime'] >= start_date) & 
            (filtered_df['datetime'] <= end_date)
        ]
    
    # Custom color palette
    # dark-teal, rosy-copper, saffron, blue-slate, tropical-teal, plum, dusty-mauve
    colors = ['#084c61', '#db504a', '#e3b505', '#4f6d7a', '#56a3a6', '#9b5de5', '#a26769']
    
    fig = go.Figure()
    
    for cluster_id in sorted(filtered_df['cluster_id'].unique()):
        cluster_df = filtered_df[filtered_df['cluster_id'] == cluster_id]
        
        hover_text = (
            '<b style="font-size:14px;">Cluster ' + cluster_df['cluster_id'].astype(str) + '</b><br><br>' +
            '<b>Subreddit:</b> r/' + cluster_df['subreddit'] + '<br>' +
            '<b>Title:</b> ' + cluster_df['title'] + '<br>' +
            '<b>Score:</b> ' + cluster_df['score'].astype(str) + '<br>' +
            '<b>Comments:</b> ' + cluster_df['num_comments'].astype(str)
        )
        
        fig.add_trace(go.Scatter(
            x=cluster_df['tsne_x'],
            y=cluster_df['tsne_y'],
            mode='markers',
            name=f'Cluster {cluster_id}',
            marker=dict(
                size=cluster_df['size'],
                color=colors[cluster_id % len(colors)],
                opacity=1,
                line=dict(width=1, color='white')
            ),
            text=hover_text,
            hovertemplate='%{text}<extra></extra>'
        ))
    
    fig.update_layout(
        template='plotly_white',
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        font=dict(family='Inter, sans-serif'),
        xaxis=dict(
            showticklabels=False, 
            showgrid=False, 
            zeroline=False,
            showline=False
        ),
        yaxis=dict(
            showticklabels=False, 
            showgrid=False, 
            zeroline=False,
            showline=False
        ),
        legend=dict(
            title=dict(text='<b>Clusters</b>', font=dict(size=13)),
            bgcolor='rgba(255,255,255,0.9)',
            bordercolor='#e2e8f0',
            borderwidth=1,
            font=dict(size=12),
            itemsizing='constant'
        ),
        hoverlabel=dict(
            bgcolor='white',
            bordercolor='#e2e8f0',
            font=dict(family='Inter, sans-serif', size=12, color='#1a202c')
        ),
        margin=dict(l=20, r=20, t=20, b=20)
    )
    
    return fig

if __name__ == '__main__':
    app.run(debug=True)