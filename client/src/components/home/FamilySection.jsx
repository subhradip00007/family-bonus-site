import { useEffect, useState } from "react";
import FamilyCard from "./FamilyCard";

function getInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function FamilySection() {
  const [families, setFamilies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/families", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load families");
        return response.json();
      })
      .then((data) => setFamilies(data.families))
      .catch((err) => {
        if (err.name !== "AbortError") setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  return (
    <section className="families">
      <h2>Families</h2>
      <p className="families-sub">Families registered in Family Bonus.</p>
      {loading ? (
        <p className="families-sub" role="status">Loading families…</p>
      ) : error ? (
        <p className="families-sub" role="status">Families couldn’t be loaded right now.</p>
      ) : families.length === 0 ? (
        <p className="families-sub">No active families yet.</p>
      ) : (
        <div className="family-grid">
          {families.map((family) => (
            <FamilyCard
              key={family.id}
              id={family.id}
              name={family.name}
              logo={family.logo}
              initials={getInitials(family.name)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default FamilySection;
