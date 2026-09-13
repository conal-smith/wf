import logo from "../assets/force5-logo.png";
import "./brand.css";

/** Platform branding is separate from both the host site and weather provider. */
export function Force5Brand() {
  return (
    <img
      className="force5-logo"
      src={logo}
      alt="Force5"
      width="100"
      height="34"
    />
  );
}
