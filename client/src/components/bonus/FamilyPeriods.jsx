import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import "./BonusViews.css";

const API = "http://localhost:5000/api";
const format = (value) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value || 0);
const dateText = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "In progress";

function FamilyPeriods() {
  const { familyId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [shareId, setShareId] = useState(null);
  const [shareUrl, setShareUrl] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [canContribute, setCanContribute] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/families/${familyId}/periods`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Could not load bonus periods");
        return body;
      })
      .then((body) => { if (!cancelled) setData(body); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    fetch(`${API}/family-admin/${familyId}`, { credentials: "include" })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => { if (!cancelled && body) setCanContribute(body.canAddData); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [familyId]);

  async function sharePeriod(period) {
    const url = `${window.location.origin}/families/${familyId}/periods/${period.id}`;
    setShareId(period.id);
    setShareUrl(url);
    setShareNotice("");
    try {
      await navigator.clipboard.writeText(url);
      setShareNotice("Link copied");
    } catch {
      setShareNotice("Copy the link below");
    }
  }

  return (
    <div className="bonus-page">
      <Navbar />
      <main className="bonus-container">
        <Link className="bonus-back" to="/">← All families</Link>
        {error ? <div className="bonus-message" role="alert">{error}</div> : !data ? <div className="bonus-message">Loading saved periods…</div> : (
          <>
            <header className="bonus-family-banner">
              {data.family.logo ? <img src={data.family.logo} alt="" /> : <span className="bonus-family-mark">{data.family.name.slice(0, 2).toUpperCase()}</span>}
              <div><p className="bonus-eyebrow">PUBLIC FAMILY BONUS</p><h1>{data.family.name}</h1><p>Saved bonus periods · no sign-in required</p></div>
              {canContribute && <Link className="bonus-outline-button" to={`/family-admin/${familyId}`}>Manage family</Link>}
            </header>
            <div className="bonus-list-heading"><div><h2>Bonus sheet list</h2><p>Choose a period to view its read-only sheet.</p></div><span>{data.periods.length} saved {data.periods.length === 1 ? "period" : "periods"}</span></div>
            {data.periods.length === 0 ? <div className="bonus-empty"><strong>No saved bonus periods yet</strong><p>When this family saves a period, it will appear here.</p></div> : (
              <section className="bonus-period-grid" aria-label="Saved bonus periods">
                {data.periods.map((period) => (
                  <article className="bonus-period-card" key={period.id}>
                    <div className="bonus-period-top"><span className={`bonus-period-state ${period.status}`}>{period.status === "finished" ? "Finished" : "In progress"}</span><span>{period.playersCount} players</span></div>
                    <h3>{period.name}</h3>
                    <p className="bonus-period-date">{dateText(period.startDate)} – {dateText(period.endDate)}</p>
                    <div className="bonus-period-total"><span>Total payout</span><strong>{format(period.payoutTotal)}</strong></div>
                    <div className="bonus-period-actions">
                      <Link className="bonus-primary-button" to={`/families/${familyId}/periods/${period.id}`}>View sheet <span aria-hidden="true">→</span></Link>
                      <button className="bonus-outline-button" onClick={() => sharePeriod(period)}>Share</button>
                    </div>
                    {shareId === period.id && <div className="bonus-share-field"><input aria-label="Direct bonus sheet link" readOnly value={shareUrl} onFocus={(event) => event.target.select()} /><span role="status">{shareNotice}</span></div>}
                  </article>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default FamilyPeriods;
