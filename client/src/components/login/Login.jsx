import { GoogleLogin } from "@react-oauth/google";
import { Link, useNavigate } from "react-router-dom";
import "./Login.css";

function Login() {
  const navigate = useNavigate();

  async function handleGoogleSuccess(credentialResponse) {
    const res = await fetch("http://localhost:5000/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ credential: credentialResponse.credential }),
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error);
      return;
    }

    console.log("Logged in:", data.user);
    navigate("/");
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">Login</h1>
        <p className="login-text">
          Sign in with your Google account. First time? You will choose a
          username next.
        </p>
        <div className="login-google-wrap">
          <GoogleLogin
            onSuccess={handleGoogleSuccess}
            onError={() => alert("Google sign-in failed")}
            theme="filled_black"
          />
        </div>
        <p className="login-note">
          No rank yet? Ask your family's owner or deputy to give you one using
          your email.
        </p>
        <Link className="login-back" to="/">
          Back to home
        </Link>
      </div>
    </div>
  );
}

export default Login;