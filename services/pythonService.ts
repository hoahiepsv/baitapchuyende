// This service manages the Pyodide instance
declare global {
  interface Window {
    loadPyodide: any;
    pyodide: any;
  }
}

let pyodideInstance: any = null;
let isLoading = false;

export const initPyodide = async () => {
  if (pyodideInstance) return pyodideInstance;
  if (isLoading) {
    while (isLoading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (pyodideInstance) return pyodideInstance;
    }
  }

  isLoading = true;
  try {
    console.log("Loading Pyodide...");
    const pyodide = await window.loadPyodide();
    await pyodide.loadPackage("matplotlib");
    await pyodide.loadPackage("numpy");
    
    // Define a helper function in Python to plot and return base64
    await pyodide.runPythonAsync(`
import matplotlib.pyplot as plt
import io
import base64
import numpy as np

def get_plot_base64():
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', dpi=150)
    buf.seek(0)
    img_str = base64.b64encode(buf.read()).decode('utf-8')
    plt.close()
    return img_str
`);

    pyodideInstance = pyodide;
    console.log("Pyodide loaded successfully.");
  } catch (error) {
    console.error("Failed to load Pyodide:", error);
    throw error;
  } finally {
    isLoading = false;
  }
  return pyodideInstance;
};

export const runPythonCode = async (code: string): Promise<string | null> => {
  const pyodide = await initPyodide();
  try {
    // Wrap code to ensure it plots to the current figure, then extract it
    await pyodide.runPythonAsync(code);
    const base64 = await pyodide.runPythonAsync("get_plot_base64()");
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error("Python execution error:", error);
    return null; // Or return error image
  }
};
