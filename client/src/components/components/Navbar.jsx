
import { useState } from 'react'

import { Link } from "react-router-dom";

function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-brand">Family Bonus</div>
      <Link to="/login" className="btn btn-outline">
        Login
      </Link>
    </nav>
  );
}

export default Navbar;