import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../login/AuthContext";

function Navbar() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  const name = user ? user.username || user.email : "";

  return (
    <nav className="navbar">
      <div className="navbar-brand">Family Bonus</div>
      {loading ? null : user ? (
        <div className="navbar-user">
          {user.picture ? (
            <img
              className="navbar-avatar"
              src={user.picture}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="navbar-avatar navbar-avatar-fallback">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="navbar-name">{name}</span>
          {user.role === "dev" && <Link className="btn btn-outline" to="/dev-admin">Dev Panel</Link>}
          <button className="btn btn-outline" onClick={handleLogout}>
            Logout
          </button>
        </div>
      ) : (
        <Link to="/login" className="btn btn-outline">
          Login
        </Link>
      )}
    </nav>
  );
}

export default Navbar;
