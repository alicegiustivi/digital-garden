import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return (
    <main className="empty">
      <h1>Your Garden</h1>
      <p>It's empty for now. Things you capture will grow here.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
