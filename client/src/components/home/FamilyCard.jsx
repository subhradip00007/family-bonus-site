
import { Link } from "react-router-dom";

function FamilyCard(props) {
  return (
    <Link className="family-card family-card-link" to={`/families/${props.id}`}>
      {props.logo ? (
        <img className="family-logo" src={props.logo} alt={`${props.name} logo`} />
      ) : (
        <div className="family-logo">{props.initials}</div>
      )}
      <div className="family-info">
        <div className="family-name">{props.name}</div>
        <div className="family-members">View family bonus sheets</div>
      </div>
      <span className="btn btn-primary family-card-cta">View family</span>
    </Link>
  );
}

export default FamilyCard;
