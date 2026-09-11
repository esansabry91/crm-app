// Reference palette from the dataviz skill (validated categorical order + status colors).
// Used as-is (unmodified) across every chart in the Pipeline Analysis page.

export const VIZ = {
  categorical: {
    blue: '#2a78d6',
    orange: '#eb6834',
    aqua: '#1baf7a',
    yellow: '#eda100',
    magenta: '#e87ba4',
    green: '#008300',
    violet: '#4a3aa7',
    red: '#e34948',
  },
  status: {
    good: '#0ca30c', // Won
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b', // Lost
  },
  ink: {
    primary: '#0b0b0b',
    secondary: '#52514e',
    muted: '#898781',
  },
  chrome: {
    surface: '#fcfcfb',
    gridline: '#e1e0d9',
    baseline: '#c3c2b7',
  },
};
