import { useState } from 'react'
import { Link } from "react-router-dom";
import './login.css'


import "./Login.css";

function Login() {
  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">Login</h1>
        <p className="login-text">
          Sign in with your Google account. First time? You will choose a
          username next.
        </p>
        <button className="btn login-google">Continue with Google</button>
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