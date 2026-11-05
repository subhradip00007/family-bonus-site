import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../login/AuthContext";
import "./DevAdmin.css";

const API = "http://localhost:5000/api/dev-admin";
const ROLES = ["Super Admin"];

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function DevAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [overview, setOverview] = useState({ families: [], assignments: [] });
  const [pageLoading, setPageLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeView, setActiveView] = useState("overview");
  const [familyName, setFamilyName] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(ROLES[0]);
  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState("all");
  const [editingFamily, setEditingFamily] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [deletingFamily, setDeletingFamily] = useState(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch(`${API}/overview`, { credentials: "include" });
    const data = await readResponse(response);
    setOverview(data);
  }, []);

  useEffect(() => {
    if (!user || user.role !== "dev") return;
    refresh()
      .catch((err) => setError(err.message))
      .finally(() => setPageLoading(false));
  }, [refresh, user]);

  const activeFamilies = overview.families.filter((family) => family.active);
  const shownAssignments = useMemo(() => {
    const query = search.trim().toLowerCase();
    return overview.assignments.filter((assignment) => {
      const matchesFamily = familyFilter === "all" || String(assignment.familyId) === familyFilter;
      const matchesSearch = !query || [assignment.email, assignment.username, assignment.familyName, assignment.role]
        .some((value) => String(value || "").toLowerCase().includes(query));
      return matchesFamily && matchesSearch;
    });
  }, [overview.assignments, familyFilter, search]);

  async function mutate(path, method, body, successMessage) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${API}${path}`, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      setOverview(await readResponse(response));
      setNotice(successMessage);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createFamily(event) {
    event.preventDefault();
    if (await mutate("/families", "POST", { name: familyName }, "Family created.")) {
      setFamilyName("");
      setActiveView("families");
    }
  }

  async function assignRole(event) {
    event.preventDefault();
    if (!familyId) {
      setError("Create or choose a family first.");
      return;
    }
    if (await mutate("/assignments", "POST", { familyId: Number(familyId), email, role }, "Role assigned.")) {
      setEmail("");
      setActiveView("assignments");
    }
  }

  async function saveFamily(family) {
    if (await mutate(`/families/${family.id}`, "PATCH", { name: editingName }, "Family name updated.")) {
      setEditingFamily(null);
    }
  }

  async function deleteFamily() {
    if (!deletingFamily || deleteConfirmName.trim().toLowerCase() !== deletingFamily.name.toLowerCase()) return;
    if (await mutate(`/families/${deletingFamily.id}`, "DELETE", null, `${deletingFamily.name} deleted.`)) {
      if (String(familyId) === String(deletingFamily.id)) setFamilyId("");
      setDeletingFamily(null);
      setDeleteConfirmName("");
    }
  }

  async function toggleFamily(family) {
    const verb = family.active ? "disabled" : "enabled";
    await mutate(`/families/${family.id}`, "PATCH", { active: !family.active }, `Family ${verb}.`);
  }

  async function saveLogo(family, file) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > 1024 * 1024) {
      setError("Logo must be 1 MB or smaller.");
      return;
    }

    setError("");
    try {
      const logo = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read that image"));
        reader.readAsDataURL(file);
      });
      await mutate(`/families/${family.id}`, "PATCH", { logo }, "Family logo updated.");
    } catch (err) {
      setError(err.message);
    }
  }

  if (authLoading) return <main className="dev-loading">Checking Dev access…</main>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "dev") {
    return (
      <main className="dev-denied">
        <span className="dev-lock" aria-hidden="true">⌑</span>
        <h1>Dev access required</h1>
        <p>This panel is only available to the developer account.</p>
        <Link to="/">Return to Family Bonus</Link>
      </main>
    );
  }

  if (pageLoading) return <main className="dev-loading">Loading your admin panel…</main>;

  return (
    <div className="dev-shell">
      <aside className="dev-sidebar">
        <Link className="dev-brand" to="/">
          <span className="dev-brand-mark" aria-hidden="true">✦</span>
          <span><strong>FAMILY CONTROL</strong><small>DEVELOPER ADMIN</small></span>
        </Link>
        <div className="dev-side-rule" />
        <nav className="dev-nav" aria-label="Admin navigation">
          <button className={activeView === "overview" ? "selected" : ""} onClick={() => setActiveView("overview")}><span>▦</span>Overview</button>
          <button className={activeView === "families" ? "selected" : ""} onClick={() => setActiveView("families")}><span>♧</span>Families</button>
          <button className={activeView === "assignments" ? "selected" : ""} onClick={() => setActiveView("assignments")}><span>▱</span>Role Assignments</button>
        </nav>
        <div className="dev-sidebar-bottom">
          <span className="dev-online-dot" /> Signed in as Dev
          <Link to="/">← Back to Family Bonus</Link>
        </div>
      </aside>

      <main className="dev-main">
        <header className="dev-topbar">
          <div>
            <div className="dev-eyebrow">FAMILY BONUS <span>/</span> DEVELOPER</div>
            <h1>Dev Control Panel <span className="dev-access-badge">⌘ DEV ACCESS</span></h1>
          </div>
          <div className="dev-profile"><span className="dev-profile-avatar">{(user.username || user.email || "D").charAt(0).toUpperCase()}</span><span><strong>{user.username || "Developer"}</strong><small>{user.email}</small></span></div>
        </header>

        {error && <div className="dev-alert dev-alert-error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
        {notice && <div className="dev-alert dev-alert-success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}

        <div className="dev-content">
          <section className="dev-metrics" aria-label="Overview metrics">
            <Metric icon="♧" value={overview.families.length} label="Registered Families" tone="blue" />
            <Metric icon="ϟ" value={activeFamilies.length} label="Active" tone="amber" />
            <Metric icon="♙" value={overview.families.reduce((total, family) => total + family.memberCount, 0)} label="Members" tone="blue" />
            <Metric icon="▱" value={overview.assignments.length} label="Role Assignments" tone="amber" />
          </section>

          {activeView === "overview" && (
            <>
              <section className="dev-action-grid">
                <form className="dev-panel dev-form-panel" onSubmit={createFamily}>
                  <PanelHeading icon="＋" title="Create a family" subtitle="Register a new family in Family Bonus." />
                  <label htmlFor="family-name">Family name</label>
                  <input id="family-name" value={familyName} onChange={(event) => setFamilyName(event.target.value)} placeholder="Enter family name (e.g., Night Wolves)" minLength={2} maxLength={40} required />
                  <button className="dev-button dev-button-amber" type="submit" disabled={busy}>＋ <span>Create Family</span></button>
                </form>

                <form className="dev-panel dev-form-panel" onSubmit={assignRole}>
                  <PanelHeading icon="♙" title="Quick role assignment" subtitle="Assign a role to a player within a family." />
                  <label htmlFor="assign-family">Family</label>
                  <select id="assign-family" value={familyId} onChange={(event) => setFamilyId(event.target.value)} required>
                    <option value="">Choose a family</option>
                    {activeFamilies.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
                  </select>
                  <label htmlFor="player-email">Player Google email</label>
                  <input id="player-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="player@gmail.com" required />
                  <label htmlFor="player-role">Role</label>
                  <select id="player-role" value={role} onChange={(event) => setRole(event.target.value)}>{ROLES.map((item) => <option key={item}>{item}</option>)}</select>
                  <button className="dev-button dev-button-blue" type="submit" disabled={busy || activeFamilies.length === 0}>♙ <span>Assign Role</span></button>
                  <p className="dev-form-hint">You can assign a role before they sign up. It will attach to their account when they first sign in.</p>
                </form>
              </section>
              <AssignmentTable assignments={overview.assignments.slice(0, 6)} onRemove={(id) => mutate(`/assignments/${id}`, "DELETE", null, "Role assignment removed.")} busy={busy} compact />
            </>
          )}

          {activeView === "families" && (
            <section className="dev-panel dev-table-panel">
              <div className="dev-section-heading"><PanelHeading icon="♧" title="Families" subtitle="Create, rename, and disable family groups." /><span className="dev-count-pill">{overview.families.length} total</span></div>
              <form className="dev-create-inline" onSubmit={createFamily}><input aria-label="New family name" value={familyName} onChange={(event) => setFamilyName(event.target.value)} placeholder="New family name" minLength={2} maxLength={40} required /><button className="dev-button dev-button-amber" disabled={busy}>＋ Create Family</button></form>
              {overview.families.length === 0 ? <EmptyState title="No families yet" text="Create a family to start organizing roles." /> : (
                <div className="dev-family-list">{overview.families.map((family) => (
                  <article className="dev-family-row" key={family.id}>
                    {family.logo ? <img className="dev-family-avatar" src={family.logo} alt="" /> : <span className="dev-family-avatar">{family.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>}
                    <div className="dev-family-details">{editingFamily === family.id ? <input aria-label="Family name" value={editingName} onChange={(event) => setEditingName(event.target.value)} autoFocus /> : <strong>{family.name}</strong>}<small>{family.memberCount} members · {family.assignmentCount} role assignments</small></div>
                    <span className={`dev-status ${family.active ? "active" : "inactive"}`}><i />{family.active ? "Active" : "Disabled"}</span>
                    <div className="dev-row-actions">
                      <label className="dev-logo-upload" htmlFor={`family-logo-${family.id}`}>{family.logo ? "Change logo" : "Add logo"}</label>
                      <input className="dev-logo-input" id={`family-logo-${family.id}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) saveLogo(family, file); event.target.value = ""; }} />
                      {family.logo && <button onClick={() => mutate(`/families/${family.id}`, "PATCH", { logo: null }, "Family logo removed.")} disabled={busy}>Remove logo</button>}
                      {editingFamily === family.id ? <><button onClick={() => saveFamily(family)} disabled={busy}>Save</button><button onClick={() => setEditingFamily(null)}>Cancel</button></> : <><button onClick={() => { setEditingFamily(family.id); setEditingName(family.name); }}>Rename</button><button className={family.active ? "danger" : ""} onClick={() => toggleFamily(family)} disabled={busy}>{family.active ? "Disable" : "Enable"}</button><button className="delete" onClick={() => { setDeletingFamily(family); setDeleteConfirmName(""); setError(""); }} disabled={busy}>Delete</button></>}
                    </div>
                  </article>
                ))}</div>
              )}
            </section>
          )}

          {activeView === "assignments" && (
            <AssignmentTable assignments={shownAssignments} onRemove={(id) => mutate(`/assignments/${id}`, "DELETE", null, "Role assignment removed.")} busy={busy} search={search} onSearch={setSearch} familyFilter={familyFilter} onFamilyFilter={setFamilyFilter} families={overview.families} />
          )}

          <footer className="dev-footer">Family Control Panel <span>·</span> Access restricted to the developer account</footer>
        </div>
        {deletingFamily && <div className="dev-confirm-overlay">
          <section className="dev-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-family-title">
            <span className="dev-confirm-icon" aria-hidden="true">!</span>
            <h2 id="delete-family-title">Delete {deletingFamily.name}?</h2>
            <p>This permanently deletes the family, its roles, bonus sheets, and activity history.</p>
            <label htmlFor="confirm-family-name">Type <strong>{deletingFamily.name}</strong> to confirm</label>
            <input id="confirm-family-name" value={deleteConfirmName} onChange={(event) => setDeleteConfirmName(event.target.value)} autoFocus />
            <div className="dev-confirm-actions"><button onClick={() => { setDeletingFamily(null); setDeleteConfirmName(""); }} disabled={busy}>Cancel</button><button className="danger" onClick={deleteFamily} disabled={busy || deleteConfirmName.trim().toLowerCase() !== deletingFamily.name.toLowerCase()}>{busy ? "Deleting…" : "Delete family"}</button></div>
          </section>
        </div>}
      </main>
    </div>
  );
}

function Metric({ icon, value, label, tone }) {
  return <article className={`dev-metric ${tone}`}><span className="dev-metric-icon">{icon}</span><div><strong>{value}</strong><small>{label}</small></div></article>;
}

function PanelHeading({ icon, title, subtitle }) {
  return <div className="dev-panel-heading"><span className="dev-heading-icon">{icon}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function AssignmentTable({ assignments, onRemove, busy, compact = false, search, onSearch, familyFilter, onFamilyFilter, families = [] }) {
  return (
    <section className="dev-panel dev-table-panel">
      <div className="dev-section-heading"><PanelHeading icon="▱" title={compact ? "Recent role assignments" : "Role assignments"} subtitle={compact ? "Latest roles across all families." : "Search, review, and remove individual roles."} />{compact && <span className="dev-count-pill">{assignments.length} recent</span>}</div>
      {!compact && <div className="dev-table-controls"><label className="dev-search">⌕<input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search by player, family, or role…" /></label><select aria-label="Filter by family" value={familyFilter} onChange={(event) => onFamilyFilter(event.target.value)}><option value="all">All families</option>{families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></div>}
      <div className="dev-table-scroll"><table className="dev-table"><thead><tr><th>Player</th><th>Family</th><th>Role</th><th>Status</th>{!compact && <th aria-label="Actions" />}</tr></thead><tbody>
        {assignments.map((assignment) => <tr key={assignment.assignmentId}><td><span className="dev-player-avatar">{(assignment.username || assignment.email)[0].toUpperCase()}</span><span className="dev-player-name"><strong>{assignment.username || assignment.email.split("@")[0]}</strong><small>{assignment.email}</small></span></td><td><span className="dev-family-tag">{assignment.familyName}</span></td><td><span className={`dev-role-tag ${assignment.role === "Super Admin" ? "super" : ""}`}>{assignment.role}</span></td><td><span className={`dev-status ${assignment.pending ? "pending" : assignment.active ? "active" : "inactive"}`}><i />{assignment.pending ? "Pending signup" : assignment.active ? "Active" : "Disabled"}</span></td>{!compact && <td className="dev-table-action">{assignment.role === "Super Admin" ? <button onClick={() => onRemove(assignment.assignmentId)} disabled={busy}>Remove</button> : <span className="dev-form-hint">Family-managed</span>}</td>}</tr>)}
        {assignments.length === 0 && <tr><td colSpan={compact ? 4 : 5}><EmptyState title="No role assignments" text={compact ? "Assignments will appear here when you add roles to players." : "Try another search or assign a role from the overview."} /></td></tr>}
      </tbody></table></div>
    </section>
  );
}

function EmptyState({ title, text }) {
  return <div className="dev-empty"><span>⌕</span><strong>{title}</strong><p>{text}</p></div>;
}

export default DevAdmin;
