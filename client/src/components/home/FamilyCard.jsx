
import { useState } from 'react'

function FamilyCard(props) {
  return (
    <div className="family-card">
      <div className="family-logo">{props.initials}</div>
      <div className="family-info">
        <div className="family-name">{props.name}</div>
        <div className="family-members">{props.members} members</div>
      </div>
      <button className="btn btn-primary">View bonus</button>
    </div>
  );
}

export default FamilyCard;