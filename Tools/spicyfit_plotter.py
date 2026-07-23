r"""
Slider semantics (mathematical definition):

Let p = col_0, with domain p in [min_0, max_0].

Define two independently slider-controlled bounds:
    a = new_min_0
    b = new_max_0

with:
    min_0 <= a <= b <= max_0.

Define the mask over row indices k:
    M = { k : a <= p[k] <= b }

The displayed curve is:
    (X[k], Y[k]) for k in M,
    NaN otherwise.

The plotted domain is therefore the parameter sub-interval:
    [a, b]

where:
    a and b are independently adjustable from the lower and upper sliders.
"""
import numpy as np
from dash import Dash, dcc, html, Input, Output
import plotly.graph_objects as go


def build_app(data, x_col=1, y_col=2, normal_x=False, normal_y=False,
              n_steps=50):

    n_cols = data.shape[1]

    if not (1 <= x_col < n_cols) or not (1 <= y_col < n_cols):
        raise ValueError(f"x_col/y_col must be in [1, {n_cols - 1}]")

    param = data[:, 0]
    pmin, pmax = np.min(param), np.max(param)

    if pmax == pmin:
        raise ValueError("col_0 is constant")

    step = (pmax - pmin) / n_steps
    cols = list(range(n_cols))

    def normalize(v):
        vmin, vmax = np.min(v), np.max(v)
        return v if vmax == vmin else 2 * (v - vmin) / (vmax - vmin) - 1

    def get_col(i, normal):
        return normalize(data[:, i]) if normal else data[:, i]

    def mask_for(a, b):
        return (param >= a) & (param <= b)

    app = Dash(__name__)

    app.layout = html.Div([
        html.Div([
            dcc.Dropdown(id="x-selector",
                         options=[{"label": f"X {i}", "value": i} for i in cols],
                         value=x_col, clearable=False,
                         style={"width": "150px"}),
            dcc.Dropdown(id="y-selector",
                         options=[{"label": f"Y {i}", "value": i} for i in cols],
                         value=y_col, clearable=False,
                         style={"width": "150px"})
        ], style={"display": "flex", "gap": "10px"}),

        dcc.Slider(id="param-min-slider", min=pmin, max=pmax, step=step,
                   value=pmin, marks=None,
                   tooltip={"placement": "bottom",
                            "always_visible": True},
                   updatemode="drag"),

        dcc.Slider(id="param-max-slider", min=pmin, max=pmax, step=step,
                   value=pmax, marks=None,
                   tooltip={"placement": "bottom",
                            "always_visible": True},
                   updatemode="drag"),

        dcc.Checklist(id="normalize-toggle",
                      options=[{"label": "Normalize X", "value": "x"},
                               {"label": "Normalize Y", "value": "y"}],
                      value=[v for v, flag in (("x", normal_x),
                                               ("y", normal_y)) if flag]),

        dcc.Graph(id="main-graph")
    ])

    @app.callback(
        Output("main-graph", "figure"),
        Input("x-selector", "value"),
        Input("y-selector", "value"),
        Input("param-min-slider", "value"),
        Input("param-max-slider", "value"),
        Input("normalize-toggle", "value")
    )
    def update_figure(x_sel, y_sel, a, b, norm_flags):

        if a > b:
            a, b = b, a

        use_norm_x = "x" in norm_flags
        use_norm_y = "y" in norm_flags

        m = mask_for(a, b)
        x_full = get_col(x_sel, use_norm_x)
        y_full = get_col(y_sel, use_norm_y)

        fig = go.Figure(go.Scatter(
            x=np.where(m, x_full, np.nan),
            y=np.where(m, y_full, np.nan),
            mode="lines"
        ))

        fig.update_layout(template="plotly_white")

        return fig

    return app


if __name__ == "__main__":

    filename = "Polar_H10_1D61CD3D_1784733608827_ACC.txt"
    data = np.loadtxt(filename, delimiter=",")

    app = build_app(data)
    app.run(debug=True)
