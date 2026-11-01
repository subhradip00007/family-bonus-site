import { useState } from 'react'
import FamilyCard from "./FamilyCard";

function FamilySection(props) {
  return (
    <section className="families">
      <h2>Families</h2>
      <p className="families-sub">Pick a family to see its bonus list.</p>
      <div className="family-grid">
        {props.families.map((family) => (
          <FamilyCard
            key={family.id}
            name={family.name}
            initials={family.initials}
          />
        ))}
      </div>
    </section>
  );
}

export default FamilySection;