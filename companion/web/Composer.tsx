import { useEffect, useRef, type Ref } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "../../ui";
import { controlStyles } from "../../ui/control";
import { COMPANION_NAME, MAX_MESSAGE_CHARS } from "../shared/protocol";

/** The message box: Enter sends, Shift+Enter adds a line. */
export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  busy,
  placeholder = `Ask ${COMPANION_NAME} about the wind…`,
  inputRef,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: (text: string) => void;
  disabled: boolean;
  busy: boolean;
  placeholder?: string;
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const styles = controlStyles({ kind: "text" });
  const own = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    // Keep the newest line in view once the box stops growing.
    if (own.current) own.current.scrollTop = own.current.scrollHeight;
  }, [value]);
  const submit = () => {
    const text = value.trim();
    if (!text || disabled || busy) return;
    onSend(text);
  };
  return (
    <form
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div
        className={styles.box({ className: "items-end gap-1 py-1 pr-1 pl-3" })}
      >
        <textarea
          ref={(node) => {
            own.current = node;
            if (typeof inputRef === "function") inputRef(node);
            else if (inputRef) inputRef.current = node;
          }}
          aria-label={`Message ${COMPANION_NAME}`}
          rows={1}
          maxLength={MAX_MESSAGE_CHARS}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          className={styles.input({
            className:
              "max-h-30 min-h-8 resize-none self-center py-2 leading-normal field-sizing-content",
          })}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          icon
          aria-label="Send"
          disabled={disabled || busy || !value.trim()}
        >
          <ArrowUp size={16} aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}
