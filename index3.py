import tkinter as tk
from tkinter import ttk, messagebox
import numpy as np

class AdvancedMatrixTool:
    def __init__(self, root):
        self.root = root
        self.root.title("Pro Matrix Operations")
        self.root.geometry("800x750")
        
        # Configure Styles
        style = ttk.Style()
        style.theme_use('clam')  # 'clam' usually looks cleaner than default
        style.configure("TButton", padding=6, relief="flat", background="#ccc")
        style.configure("TLabel", font=("Helvetica", 10))
        style.configure("Header.TLabel", font=("Helvetica", 12, "bold"))

        # --- CONTAINER 1: Configuration (Top) ---
        frame_config = ttk.LabelFrame(root, text="Step 1: Matrix Configuration", padding=10)
        frame_config.pack(fill="x", padx=15, pady=10)

        # Matrix A Dimensions
        ttk.Label(frame_config, text="Matrix A:").grid(row=0, column=0, padx=5)
        self.row_a = ttk.Entry(frame_config, width=3, justify='center')
        self.row_a.insert(0, "2")
        self.row_a.grid(row=0, column=1)
        ttk.Label(frame_config, text="x").grid(row=0, column=2)
        self.col_a = ttk.Entry(frame_config, width=3, justify='center')
        self.col_a.insert(0, "2")
        self.col_a.grid(row=0, column=3)

        # Spacer
        ttk.Label(frame_config, text="       ").grid(row=0, column=4)

        # Matrix B Dimensions
        ttk.Label(frame_config, text="Matrix B:").grid(row=0, column=5, padx=5)
        self.row_b = ttk.Entry(frame_config, width=3, justify='center')
        self.row_b.insert(0, "2")
        self.row_b.grid(row=0, column=6)
        ttk.Label(frame_config, text="x").grid(row=0, column=7)
        self.col_b = ttk.Entry(frame_config, width=3, justify='center')
        self.col_b.insert(0, "2")
        self.col_b.grid(row=0, column=8)

        # Action Buttons
        ttk.Button(frame_config, text="Generate Grids", command=self.create_grids).grid(row=0, column=9, padx=20)
        ttk.Button(frame_config, text="Fill Random", command=self.fill_random).grid(row=0, column=10)

        # --- CONTAINER 2: Inputs (Middle) ---
        self.frame_inputs = ttk.Frame(root, padding=5)
        self.frame_inputs.pack(fill="both", expand=True, padx=15)
        
        # Left side: Matrix A Input Area
        self.frame_a = ttk.LabelFrame(self.frame_inputs, text="Matrix A Input", padding=10)
        self.frame_a.pack(side="left", fill="both", expand=True, padx=5)
        
        # Right side: Matrix B Input Area
        self.frame_b = ttk.LabelFrame(self.frame_inputs, text="Matrix B Input", padding=10)
        self.frame_b.pack(side="right", fill="both", expand=True, padx=5)

        self.entries_a = []
        self.entries_b = []

        # --- CONTAINER 3: Operations (Bottom) ---
        frame_ops = ttk.LabelFrame(root, text="Step 2: Operations", padding=10)
        frame_ops.pack(fill="x", padx=15, pady=10)

        # Grid layout for buttons to make them even
        ops = [
            ("A + B", self.add),
            ("A - B", self.subtract),
            ("A × B", self.multiply),
            ("Transpose A", self.transpose_a),
            ("Determinant A", self.determinant_a),
            ("Clear All", self.clear_all)
        ]

        for i, (text, func) in enumerate(ops):
            btn = ttk.Button(frame_ops, text=text, command=func)
            btn.grid(row=0, column=i, padx=5, sticky="ew")
        
        # Make buttons stretch evenly
        for i in range(len(ops)):
            frame_ops.columnconfigure(i, weight=1)

        # --- CONTAINER 4: Results (Footer) ---
        frame_res = ttk.LabelFrame(root, text="Step 3: Results", padding=10)
        frame_res.pack(fill="both", expand=True, padx=15, pady=10)

        self.text_result = tk.Text(frame_res, height=8, font=("Consolas", 11), bg="#f4f4f4", relief="flat")
        self.text_result.pack(side="left", fill="both", expand=True)
        
        # Scrollbar for result
        scrollbar = ttk.Scrollbar(frame_res, command=self.text_result.yview)
        scrollbar.pack(side="right", fill="y")
        self.text_result['yscrollcommand'] = scrollbar.set

    def create_grids(self):
        # 1. Clear old grids
        for widget in self.frame_a.winfo_children(): widget.destroy()
        for widget in self.frame_b.winfo_children(): widget.destroy()
        self.entries_a.clear()
        self.entries_b.clear()

        try:
            # 2. Get dimensions
            ra, ca = int(self.row_a.get()), int(self.col_a.get())
            rb, cb = int(self.row_b.get()), int(self.col_b.get())

            # 3. Build Grid A
            for i in range(ra):
                row_entries = []
                for j in range(ca):
                    e = ttk.Entry(self.frame_a, width=5, justify='center')
                    e.grid(row=i, column=j, padx=2, pady=2)
                    e.insert(0, "0")
                    row_entries.append(e)
                self.entries_a.append(row_entries)

            # 4. Build Grid B
            for i in range(rb):
                row_entries = []
                for j in range(cb):
                    e = ttk.Entry(self.frame_b, width=5, justify='center')
                    e.grid(row=i, column=j, padx=2, pady=2)
                    e.insert(0, "0")
                    row_entries.append(e)
                self.entries_b.append(row_entries)

        except ValueError:
            messagebox.showerror("Input Error", "Rows and Columns must be integers.")

    def get_matrix(self, entries):
        """Helper to convert grid of Entry widgets to NumPy array"""
        if not entries: return None
        try:
            return np.array([[float(e.get()) for e in row] for row in entries])
        except ValueError:
            messagebox.showerror("Data Error", "Please ensure all matrix fields contain numbers.")
            return None

    def display(self, title, result):
        self.text_result.delete(1.0, tk.END)
        self.text_result.insert(tk.END, f"=== {title} ===\n\n")
        
        if isinstance(result, (float, int, np.floating)):
            self.text_result.insert(tk.END, f"{result:.4f}")
        else:
            # Pretty print matrix with alignment
            for row in result:
                line = "  ".join(f"{val:>10.2f}" for val in row)
                self.text_result.insert(tk.END, line + "\n")
                
    def fill_random(self):
        """Fills all active entry boxes with random integers 1-10"""
        self.create_grids() # Reset first
        import random
        for row in self.entries_a:
            for e in row:
                e.delete(0, tk.END)
                e.insert(0, str(random.randint(1, 10)))
        for row in self.entries_b:
            for e in row:
                e.delete(0, tk.END)
                e.insert(0, str(random.randint(1, 10)))

    # --- Operations ---
    def add(self):
        a, b = self.get_matrix(self.entries_a), self.get_matrix(self.entries_b)
        if a is not None and b is not None:
            if a.shape == b.shape: self.display("Addition Result", a + b)
            else: messagebox.showerror("Error", f"Dimensions mismatch: {a.shape} vs {b.shape}")

    def subtract(self):
        a, b = self.get_matrix(self.entries_a), self.get_matrix(self.entries_b)
        if a is not None and b is not None:
            if a.shape == b.shape: self.display("Subtraction Result", a - b)
            else: messagebox.showerror("Error", f"Dimensions mismatch: {a.shape} vs {b.shape}")

    def multiply(self):
        a, b = self.get_matrix(self.entries_a), self.get_matrix(self.entries_b)
        if a is not None and b is not None:
            if a.shape[1] == b.shape[0]: self.display("Multiplication Result", np.dot(a, b))
            else: messagebox.showerror("Error", f"Cols of A ({a.shape[1]}) must equal Rows of B ({b.shape[0]}).")

    def transpose_a(self):
        a = self.get_matrix(self.entries_a)
        if a is not None: self.display("Transpose of A", a.T)

    def determinant_a(self):
        a = self.get_matrix(self.entries_a)
        if a is not None:
            if a.shape[0] == a.shape[1]: self.display("Determinant of A", np.linalg.det(a))
            else: messagebox.showerror("Error", "Determinant requires a square matrix.")

    def clear_all(self):
        self.create_grids()
        self.text_result.delete(1.0, tk.END)

if __name__ == "__main__":
    root = tk.Tk()
    # Optional: Set icon if you have one, otherwise skip
    # root.iconbitmap('icon.ico') 
    app = AdvancedMatrixTool(root)
    root.mainloop()