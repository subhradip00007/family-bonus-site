import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import "./Login.css";

function Username() {
  const { user, loading, setUser } = useAuth();
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function handleSubmit(event) {
    event.preventDefault();
    const res = await fetch("/api/auth/username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error);
      return;
    }

    setUser(data.user);
    navigate("/");
  }

  if (loading) return null;
  if (!user) return <Navigate to="/login" />;

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">Choose a username</h1>
        <p className="login-text">
          This is the name staff will see. It can be anything.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            className="login-input"
            type="text"
            placeholder="Username"
            maxLength={30}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          {error && <p className="login-error">{error}</p>}
          <button className="btn btn-primary login-submit" type="submit">
            Save username
          </button>
        </form>
      </div>
    </div>
  );
}

export default Username;
