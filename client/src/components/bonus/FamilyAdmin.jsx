import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import "./BonusViews.css";

const API = "http://localhost:5000/api";
const format = (value) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value || 0);
const dateText = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "In progress";

async function responseData(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "Request failed");
    error.payload = body;
    error.status = response.status;
    throw error;
  }
  return body;
}

function toEditor(sheet) {
  const events = sheet.events.map((event) => ({ clientId: String(event.id), name: event.name, rate: Number(event.rate) }));
  const players = sheet.players.map((player) => ({
    id: player.id,
    name: player.name,
    strikePercent: Number(player.strikePercent),
    paidStatus: player.paidStatus,
    counts: Object.fromEntries(events.map((event) => [event.clientId, Number(player.counts[event.clientId] || 0)])),
  }));
  return { family: sheet.family, period: sheet.period, events, players };
}

function FamilyAdmin() {
  const { familyId } = useParams();
  const [access, setAccess] = useState(null);
  const [editor, setEditor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [shareId, setShareId] = useState(null);
  const [shareLink, setShareLink] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [auditEntries, setAuditEntries] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [lockToken, setLockToken] = useState("");
  const [lockPopup, setLockPopup] = useState(null);
  const nextId = useRef(1);

  const reload = useCallback(async () => {
    const response = await fetch(`${API}/family-admin/${familyId}`, { credentials: "include" });
    const body = await responseData(response);
    setAccess(body);
    setLoading(false);
  }, [familyId]);

  useEffect(() => {
    reload().catch((err) => { setError(err.message); setLoading(false); });
  }, [reload]);

  useEffect(() => {
    const periodId = editor?.period.id;
    if (!lockToken || !periodId) return undefined;
    const lockUrl = `${API}/family-admin/${familyId}/periods/${periodId}/lock`;
    const heartbeat = window.setInterval(async () => {
      try {
        await responseData(await fetch(lockUrl, {
          method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: lockToken }),
        }));
      } catch (err) {
        window.clearInterval(heartbeat);
        setLockToken("");
        setLockPopup({ error: err.message, lost: true });
      }
    }, 30_000);
    return () => {
      window.clearInterval(heartbeat);
      fetch(lockUrl, {
        method: "DELETE", credentials: "include", keepalive: true,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: lockToken }),
      }).catch(() => {});
    };
  }, [editor?.period.id, familyId, lockToken]);

  const canManage = Boolean(access?.canManage);
  const canAddData = Boolean(access?.canAddData);
  const isReadOnly = !lockToken || (!canManage && (!canAddData || editor?.period.status !== "active"));
  const activePeriod = access?.periods.find((period) => period.status === "active");
  const grantableRoles = access?.role === "Dev" ? ["Super Admin"] : access?.role === "Super Admin" ? ["Deputy", "HC"] : access?.role === "Deputy" ? ["HC"] : [];
  const [targetEmail, setTargetEmail] = useState("");
  const [grantRole, setGrantRole] = useState("Deputy");
  const selectedGrantRole = grantableRoles.includes(grantRole) ? grantRole : grantableRoles[0];

  const calculatedPlayers = useMemo(() => {
    if (!editor) return [];
    return editor.players.map((player) => {
      const subtotal = editor.events.reduce((sum, event) => sum + Number(event.rate || 0) * Number(player.counts[event.clientId] || 0), 0);
      const deduction = subtotal * Number(player.strikePercent || 0) / 100;
      return { ...player, subtotal, deduction, payout: subtotal - deduction };
    });
  }, [editor]);

  async function startPeriod() {
    setAuditOpen(false);
    setRolesOpen(false);
    setBusy(true); setError(""); setNotice("");
    try {
      const token = crypto.randomUUID();
      const sheet = await responseData(await fetch(`${API}/family-admin/${familyId}/periods`, {
        method: "POST", credentials: "include", headers: { "X-Sheet-Lock": token },
      }));
      setEditor(toEditor(sheet));
      setLockToken(token);
      await reload();
      if (auditOpen) await refreshAudit();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function openPeriod(periodId) {
    setBusy(true); setError(""); setNotice("");
    setLockPopup(null);
    const token = crypto.randomUUID();
    try {
      await responseData(await fetch(`${API}/family-admin/${familyId}/periods/${periodId}/lock`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }));
      const sheet = await responseData(await fetch(`${API}/family-admin/${familyId}/periods/${periodId}`, { credentials: "include" }));
      setEditor(toEditor(sheet));
      setLockToken(token);
    } catch (err) {
      if (err.status === 423) setLockPopup({ ...(err.payload?.lock || {}), error: err.message });
      else setError(err.message);
      fetch(`${API}/family-admin/${familyId}/periods/${periodId}/lock`, {
        method: "DELETE", credentials: "include", keepalive: true,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      }).catch(() => {});
    }
    finally { setBusy(false); }
  }

  function updatePeriod(field, value) {
    setEditor((current) => ({ ...current, period: { ...current.period, [field]: value } }));
  }

  function updateEvent(clientId, field, value) {
    setEditor((current) => ({ ...current, events: current.events.map((event) => event.clientId === clientId ? { ...event, [field]: field === "rate" ? Math.max(0, Number(value) || 0) : value } : event) }));
  }

  function updatePlayer(playerId, field, value) {
    setEditor((current) => ({ ...current, players: current.players.map((player) => player.id === playerId ? { ...player, [field]: value } : player) }));
  }

  function updateCount(playerId, eventId, value) {
    setEditor((current) => ({
      ...current,
      players: current.players.map((player) => player.id === playerId
        ? { ...player, counts: { ...player.counts, [eventId]: Math.max(0, Number(value) || 0) } }
        : player),
    }));
  }

  function addEvent() {
    const clientId = `new-event-${Date.now()}-${nextId.current++}`;
    setEditor((current) => ({
      ...current,
      events: [...current.events, { clientId, name: "New event", rate: 0 }],
      players: current.players.map((player) => ({ ...player, counts: { ...player.counts, [clientId]: 0 } })),
    }));
  }

  function removeEvent(clientId) {
    setEditor((current) => ({
      ...current,
      events: current.events.filter((event) => event.clientId !== clientId),
      players: current.players.map((player) => {
        const counts = { ...player.counts };
        delete counts[clientId];
        return { ...player, counts };
      }),
    }));
  }

  function addPlayer() {
    const id = `new-player-${Date.now()}-${nextId.current++}`;
    setEditor((current) => ({
      ...current,
      players: [...current.players, { id, name: "New player", strikePercent: 0, paidStatus: "Pending", counts: Object.fromEntries(current.events.map((event) => [event.clientId, 0])) }],
    }));
  }

  function removePlayer(playerId) {
    setEditor((current) => ({ ...current, players: current.players.filter((player) => player.id !== playerId) }));
  }

  async function saveSheet(finish = false) {
    if (!editor) return;
    if (!lockToken) {
      setLockPopup({ error: "Your edit lock is no longer active. Close and reopen the sheet to edit." });
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      let sheet;
      if (canManage) {
        const body = {
          name: editor.period.name,
          startDate: editor.period.startDate,
          finish,
          events: editor.events.map((event) => ({ clientId: event.clientId, name: event.name, rate: Number(event.rate) })),
          players: editor.players.map((player) => ({ name: player.name, strikePercent: Number(player.strikePercent), paidStatus: player.paidStatus, counts: player.counts })),
        };
        sheet = await responseData(await fetch(`${API}/family-admin/${familyId}/periods/${editor.period.id}`, {
          method: "PUT", credentials: "include", headers: { "Content-Type": "application/json", "X-Sheet-Lock": lockToken }, body: JSON.stringify(body),
        }));
      } else {
        sheet = await responseData(await fetch(`${API}/family-admin/${familyId}/periods/${editor.period.id}/data`, {
          method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", "X-Sheet-Lock": lockToken },
          body: JSON.stringify({ players: editor.players.map((player) => ({ id: player.id, counts: player.counts })) }),
        }));
      }
      setEditor(toEditor(sheet));
      setNotice(finish ? "Period finished and saved." : "Sheet saved.");
      await reload();
      if (auditOpen) await refreshAudit();
    } catch (err) {
      if (err.status === 423) setLockPopup({ ...(err.payload?.lock || {}), error: err.message });
      else setError(err.message);
    }
    finally { setBusy(false); }
  }

  async function sharePeriod(period) {
    const url = `${window.location.origin}/families/${familyId}/periods/${period.id}`;
    setShareId(period.id); setShareLink(url); setShareNotice("");
    try { await navigator.clipboard.writeText(url); setShareNotice("Link copied"); }
    catch { setShareNotice("Copy the link below"); }
  }

  async function grantFamilyRole(event) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const body = await responseData(await fetch(`${API}/family-admin/${familyId}/roles`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail, role: selectedGrantRole }),
      }));
      setAccess((current) => ({ ...current, roster: body.roster }));
      setTargetEmail("");
      setNotice(`${selectedGrantRole} role assigned.`);
      if (auditOpen) await refreshAudit();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function removeFamilyRole(assignmentId, role) {
    setBusy(true); setError(""); setNotice("");
    try {
      const body = await responseData(await fetch(`${API}/family-admin/${familyId}/roles/${assignmentId}?role=${encodeURIComponent(role)}`, { method: "DELETE", credentials: "include" }));
      setAccess((current) => ({ ...current, roster: body.roster }));
      setNotice(`${role} role removed.`);
      if (auditOpen) await refreshAudit();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function openRoleManager() {
    setAuditOpen(false);
    setRolesOpen(true);
    setEditor(null);
    setLockToken("");
  }

  function closeEditor() {
    setEditor(null);
    setLockToken("");
  }

  async function refreshAudit() {
    setAuditLoading(true);
    setError("");
    try {
      const body = await responseData(await fetch(`${API}/family-admin/${familyId}/audit`, { credentials: "include" }));
      setAuditEntries(body.entries);
    } catch (err) {
      setError(err.message);
    } finally {
      setAuditLoading(false);
    }
  }

  async function openAuditLog() {
    setRolesOpen(false);
    setAuditOpen(true);
    await refreshAudit();
  }

  function canRemoveRole(role) {
    return access?.role === "Dev" ? role === "Super Admin"
      : access?.role === "Super Admin" ? ["Deputy", "HC"].includes(role)
        : access?.role === "Deputy" && role === "HC";
  }

  if (loading) return <div className="bonus-page"><Navbar /><main className="bonus-container"><div className="bonus-message">Checking family access…</div></main></div>;
  if (!access) return <div className="bonus-page"><Navbar /><main className="bonus-container"><div className="bonus-message" role="alert">{error || "Sign in with an assigned family role to manage bonus sheets."}</div><Link className="bonus-back" to={`/families/${familyId}`}>← Public bonus periods</Link></main></div>;

  return (
    <div className="bonus-page">
      <Navbar />
      <main className="bonus-container bonus-admin-container">
        <Link className="bonus-back" to={`/families/${familyId}`}>← Public family page</Link>
        <header className="bonus-admin-header">
          {access.family.logo ? <img src={access.family.logo} alt="" /> : <span className="bonus-family-mark">{access.family.name.slice(0, 2).toUpperCase()}</span>}
          <div><p className="bonus-eyebrow">FAMILY BONUS MANAGEMENT · {access.role}</p><h1>{access.family.name}</h1><p>Save a period to publish its read-only sheet.</p></div>
          <div className="bonus-header-actions">
            <button className={`bonus-outline-button ${!auditOpen && !rolesOpen ? "selected" : ""}`} onClick={() => { setAuditOpen(false); setRolesOpen(false); }} aria-pressed={!auditOpen && !rolesOpen}>Bonus sheets</button>
            {grantableRoles.length > 0 && <button className={`bonus-outline-button ${rolesOpen ? "selected" : ""}`} onClick={openRoleManager} aria-pressed={rolesOpen}>Manage roles</button>}
            <button className={`bonus-outline-button ${auditOpen ? "selected" : ""}`} onClick={openAuditLog} aria-pressed={auditOpen}>Activity log</button>
            {!editor && canManage && <button className="bonus-primary-button" onClick={startPeriod} disabled={busy || Boolean(activePeriod)}>＋ Start a period</button>}
          </div>
        </header>
        {error && <div className="bonus-alert" role="alert">{error}</div>}
        {notice && <div className="bonus-success" role="status">{notice}</div>}

        {auditOpen ? <section className="bonus-audit-panel" aria-label="Family activity log">
          <div className="bonus-list-heading"><div><h2>Activity log</h2><p>Role changes and bonus sheet edits, newest first.</p></div><span>{auditEntries.length} entries</span></div>
          {auditLoading ? <div className="bonus-empty">Loading activity…</div> : auditEntries.length === 0 ? <div className="bonus-empty">No changes have been logged yet.</div> : (
            <div className="bonus-audit-list">
              {auditEntries.map((entry) => <article className="bonus-audit-entry" key={entry.id}>
                <div className="bonus-audit-entry-top"><span className={`bonus-audit-tag ${entry.action}`}>{entry.action.replaceAll("_", " ")}</span><time>{new Date(`${entry.createdAt.replace(" ", "T")}Z`).toLocaleString()}</time></div>
                <p>{entry.summary}</p>
                <small>By {entry.actorLabel}</small>
                {Object.keys(entry.details || {}).length > 0 && <details className="bonus-audit-details"><summary>View change details</summary><pre>{JSON.stringify(entry.details, null, 2)}</pre></details>}
              </article>)}
            </div>
          )}
        </section> : rolesOpen ? (
          <section className="bonus-role-manager bonus-role-page">
            <div className="bonus-role-page-heading"><div><h2>Family role assignments</h2><p>Manage access for this family.</p></div><span>{access.roster.members.length + access.roster.pending.length} assigned</span></div>
            {grantableRoles.length > 0 ? <div className="bonus-role-content">
              <p>Super Admin can assign Deputy and HC. Deputy can assign HC. The developer appoints the initial Super Admin.</p>
              <form className="bonus-role-form" onSubmit={grantFamilyRole}>
                <label>Player email<input type="email" value={targetEmail} onChange={(event) => setTargetEmail(event.target.value)} placeholder="player@gmail.com" required /></label>
                <label>Family role<select value={selectedGrantRole} onChange={(event) => setGrantRole(event.target.value)}>{grantableRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
                <button className="bonus-primary-button" disabled={busy}>Assign role</button>
              </form>
              <div className="bonus-roster-list">
                {access.roster.members.map((member) => member.roles.map((role) => <div className="bonus-roster-row" key={`${member.membershipId}-${role}`}><span><strong>{member.username || member.email}</strong><small>{member.email}</small></span><span className="bonus-roster-role">{role}</span>{canRemoveRole(role) && <button onClick={() => removeFamilyRole(member.membershipId, role)} disabled={busy}>Remove</button>}</div>))}
                {access.roster.pending.map((member) => <div className="bonus-roster-row" key={`pending-${member.id}-${member.role}`}><span><strong>{member.email}</strong><small>Pending signup</small></span><span className="bonus-roster-role">{member.role}</span>{canRemoveRole(member.role) && <button onClick={() => removeFamilyRole(`pending-${member.id}`, member.role)} disabled={busy}>Remove</button>}</div>)}
                {access.roster.members.length + access.roster.pending.length === 0 && <div className="bonus-empty">No family roles assigned yet.</div>}
              </div>
            </div> : <div className="bonus-empty">Your family role does not have permission to manage role assignments.</div>}
          </section>
        ) : editor ? (
          <section className="bonus-editor">
            <div className="bonus-editor-head">
              <div><p className="bonus-eyebrow">{editor.period.status === "finished" ? "SAVED PERIOD" : "CURRENT PERIOD"}</p><h2>{editor.period.status === "finished" ? "Edit saved sheet" : "Current bonus sheet"}</h2></div>
              <button className="bonus-outline-button" onClick={closeEditor}>Back to period list</button>
            </div>
            <div className="bonus-editor-fields">
              <label>Period name<input value={editor.period.name} disabled={isReadOnly} onChange={(event) => updatePeriod("name", event.target.value)} /></label>
              <label>Started<input type="date" value={editor.period.startDate} disabled={isReadOnly} onChange={(event) => updatePeriod("startDate", event.target.value)} /></label>
              <span className={`bonus-period-state ${editor.period.status}`}>{editor.period.status === "finished" ? `Finished ${dateText(editor.period.endDate)}` : "In progress"}</span>
            </div>
            <div className="bonus-editor-tools">
              <span>{canManage ? "Edit event prices, player counts, strikes, and payout status." : "HC access: add or update activity counts for this period."}</span>
              {canManage && <div><button className="bonus-outline-button" onClick={addEvent} disabled={!lockToken}>＋ Add event column</button><button className="bonus-outline-button" onClick={addPlayer} disabled={!lockToken}>＋ Add player row</button></div>}
            </div>
            <div className="bonus-table-wrap">
              <table className="bonus-sheet-table bonus-edit-table">
                <thead>
                  <tr><th>Player</th>{editor.events.map((event) => <th key={event.clientId}><div className="bonus-event-heading"><input value={event.name} disabled={!canManage || !lockToken} onChange={(e) => updateEvent(event.clientId, "name", e.target.value)} aria-label="Event name"/>{canManage && <button aria-label={`Remove ${event.name} event`} disabled={!lockToken} onClick={() => removeEvent(event.clientId)}>×</button>}</div></th>)}<th>Strike</th><th>Subtotal</th><th>Deduction</th><th>Payout</th><th>Status</th>{canManage && <th />}</tr>
                  <tr className="bonus-price-row"><th>Price per event</th>{editor.events.map((event) => <th key={event.clientId}><input className="bonus-edit-input bonus-rate-input" type="number" min="0" step="1" value={event.rate} disabled={!canManage || !lockToken} onChange={(e) => updateEvent(event.clientId, "rate", e.target.value)} aria-label={`${event.name} price per event`}/></th>)}<th>Player’s rate</th><th>—</th><th>—</th><th>—</th><th>—</th>{canManage && <th />}</tr>
                </thead>
                <tbody>
                  {calculatedPlayers.map((player) => <tr key={player.id}>
                    <td><input className="bonus-edit-input player-input" value={player.name} disabled={!canManage || !lockToken} onChange={(e) => updatePlayer(player.id, "name", e.target.value)} aria-label="Player name" /></td>
                    {editor.events.map((event) => <td key={event.clientId}><input className="bonus-edit-input bonus-number-input" type="number" min="0" step="1" value={player.counts[event.clientId] || 0} disabled={isReadOnly} onChange={(e) => updateCount(player.id, event.clientId, e.target.value)} aria-label={`${event.name} count for ${player.name}`} /></td>)}
                    <td><select className="bonus-edit-input" value={player.strikePercent} disabled={!canManage || !lockToken} onChange={(e) => updatePlayer(player.id, "strikePercent", Number(e.target.value))}><option value="0">None</option><option value="10">Strike 1 · 10%</option><option value="20">Strike 2 · 20%</option><option value="30">Strike 3 · 30%</option></select></td>
                    <td className="bonus-number">{format(player.subtotal)}</td><td className="bonus-number bonus-deduction">−{format(player.deduction)}</td><td className="bonus-number bonus-payout">{format(player.payout)}</td>
                    <td><select className="bonus-edit-input" value={player.paidStatus} disabled={!canManage || !lockToken} onChange={(e) => updatePlayer(player.id, "paidStatus", e.target.value)}><option>Pending</option><option>Paid</option></select></td>
                    {canManage && <td><button className="bonus-icon-button" disabled={!lockToken} onClick={() => removePlayer(player.id)} aria-label={`Remove ${player.name}`}>×</button></td>}
                  </tr>)}
                </tbody>
              </table>
            </div>
            <div className="bonus-editor-footer">
              <span>Strike rates deduct from each player’s subtotal.</span>
              <div>{!isReadOnly && <button className="bonus-primary-button" onClick={() => saveSheet(false)} disabled={busy || !lockToken}>Save sheet</button>}{canManage && editor.period.status === "active" && <button className="bonus-finish-button" onClick={() => saveSheet(true)} disabled={busy || !lockToken}>Finish &amp; save period</button>}</div>
            </div>
          </section>
        ) : (
          <>
          <section className="bonus-manager-list">
            <div className="bonus-list-heading"><div><h2>Bonus sheet list</h2><p>Saved periods are public and can be shared directly.</p></div><span>{access.periods.length} periods</span></div>
            {!canManage && !canAddData && <div className="bonus-empty">This account has view-only family access.</div>}
            {access.periods.length === 0 ? <div className="bonus-empty"><strong>No bonus periods yet</strong><p>Start a period and save the sheet to publish it.</p></div> : (
              <div className="bonus-period-grid">
                {access.periods.map((period) => (
                  <article className="bonus-period-card" key={period.id}>
                    <div className="bonus-period-top"><span className={`bonus-period-state ${period.status}`}>{period.status === "finished" ? "Finished" : "In progress"}</span><span>{period.playersCount} players</span></div>
                    <h3>{period.name}</h3><p className="bonus-period-date">{dateText(period.startDate)} – {dateText(period.endDate)}</p>
                    <div className="bonus-period-total"><span>Total payout</span><strong>{format(period.payoutTotal)}</strong></div>
                    <div className="bonus-period-actions">
                      {canManage || (canAddData && period.status === "active") ? <button className="bonus-primary-button" onClick={() => openPeriod(period.id)} disabled={busy}>{canManage ? "Edit sheet" : "Add activity data"}</button> : <Link className="bonus-primary-button" to={`/families/${familyId}/periods/${period.id}`}>View sheet</Link>}
                      {period.savedAt && <button className="bonus-outline-button" onClick={() => sharePeriod(period)}>Share</button>}
                      {period.savedAt && <Link className="bonus-text-link" to={`/families/${familyId}/periods/${period.id}`}>Public view</Link>}
                    </div>
                    {shareId === period.id && <div className="bonus-share-field"><input aria-label="Direct bonus sheet link" readOnly value={shareLink} onFocus={(event) => event.target.select()} /><span role="status">{shareNotice}</span></div>}
                  </article>
                ))}
              </div>
            )}
          </section>
          </>
        )}
      </main>
      {lockPopup && <div className="bonus-lock-overlay">
        <section className="bonus-lock-dialog" role="alertdialog" aria-modal="true" aria-labelledby="bonus-lock-title">
          <span className="bonus-lock-icon" aria-hidden="true">🔒</span>
          <h2 id="bonus-lock-title">{lockPopup.owner ? "Bonus sheet is being edited" : "Edit lock unavailable"}</h2>
          <p>{lockPopup.owner ? `${lockPopup.owner} is editing this bonus sheet. Please try again after they finish.` : lockPopup.error}</p>
          {lockPopup.expiresAt && <small>The lock will renew while they are editing.</small>}
          <button className="bonus-primary-button" onClick={() => setLockPopup(null)}>Got it</button>
        </section>
      </div>}
    </div>
  );
}

export default FamilyAdmin;
