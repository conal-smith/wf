import logo from "../assets/force5-logo.png";
import "./brand.css";

/** Platform branding is separate from both the host site and weather provider. */
export function Force5Brand() {
  return (
    <svg
      className="force5-logo"
      role="img"
      aria-label="Force5"
      viewBox="90 150 580 400"
      width="42"
      height="30"
    >
      <title>Force5</title>
      <image href={logo} width="2048" height="683" />
    </svg>
  );
}
