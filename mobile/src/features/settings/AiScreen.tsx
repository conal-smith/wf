/**
 * wingfoil.ie in your AI assistant (ai/web/AiApp.tsx): the MCP server's
 * address, a button where a client has an install link, and the lines to paste
 * where it does not. The app carries no clipboard module, so each line is
 * selectable text and a share button, whose sheet has Copy at its head.
 */
import { Share, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { tick } from "../../components/haptics";
import { ListSection } from "../../components/List";
import { T } from "../../components/Text";
import { endpoints } from "../../config/env";
import { colors, fonts, space } from "../../theme/tokens";
import { SettingsPage, openLink } from "./SettingsPage";
import {
  EXAMPLE_QUESTIONS,
  claudeCodeLine,
  claudeConnectorLink,
  codexLines,
  geminiLines,
  mcpEndpoint,
} from "./settingsLogic";

function Snippet({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.snippet}>
      <T variant="figureSm" selectable style={styles.code} accessibilityLabel={`${label}: ${value}`}>
        {value}
      </T>
      <Button
        kind="pill"
        size="sm"
        label="Copy or share"
        accessibilityHint={`Opens the share sheet with ${label}; Copy is at its head`}
        style={styles.copy}
        onPress={() => {
          tick();
          void Share.share({ message: value }).catch(() => undefined);
        }}
      />
    </View>
  );
}

export function AiScreen() {
  const url = mcpEndpoint(endpoints.api);
  return (
    <SettingsPage title="Ask your AI">
      <View style={styles.intro}>
        <T variant="prose" color="ink2" style={styles.lead}>
          Add wingfoil.ie to Claude, ChatGPT or your coding agent and it reads the same forecast as the chart.
        </T>
        <T variant="eyebrow" caps color="muted">
          Every model · waves, tides, daylight · free, read-only, no account
        </T>
      </View>

      <ListSection title="The server" footer="An MCP server over Streamable HTTP. Any MCP client can use this address.">
        <Snippet value={url} label="the server address" />
      </ListSection>

      <ListSection title="Claude">
        <View style={styles.block}>
          <T variant="body" color="ink2">
            Opens Claude with the connector filled in; confirm with Add. Once added it is in Claude on your phone too.
          </T>
          <Button kind="primary" label="Add to Claude" onPress={() => openLink(claudeConnectorLink(url))} />
        </View>
      </ListSection>

      <ListSection title="ChatGPT">
        <View style={styles.block}>
          <T variant="body" color="ink2">
            On chatgpt.com, turn on Developer mode in Settings, then create a connector with the server address above
            and no authentication.
          </T>
          <Button kind="pill" label="Open ChatGPT settings" onPress={() => openLink("https://chatgpt.com/#settings")} />
        </View>
      </ListSection>

      <ListSection title="Command-line agents">
        <View style={styles.block}>
          <T variant="eyebrow" caps color="muted">
            Claude Code
          </T>
          <Snippet value={claudeCodeLine(url)} label="the Claude Code command" />
          <T variant="eyebrow" caps color="muted">
            Codex · ~/.codex/config.toml
          </T>
          <Snippet value={codexLines(url)} label="the Codex config" />
          <T variant="eyebrow" caps color="muted">
            Gemini CLI · ~/.gemini/settings.json
          </T>
          <Snippet value={geminiLines(url)} label="the Gemini CLI config" />
        </View>
      </ListSection>

      <ListSection title="Then ask">
        {EXAMPLE_QUESTIONS.map((q) => (
          <T key={q} variant="prose" color="ink2" style={styles.prompt}>
            “{q}”
          </T>
        ))}
      </ListSection>

      <View style={styles.notice}>
        <T variant="body">
          Your assistant reads model forecasts, not the beach. It is told never to call conditions safe: check the
          launch, the tide, offshore wind and local advice yourself.
        </T>
      </View>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  intro: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm },
  lead: { fontFamily: fonts.bodyItalic },
  block: { gap: space.sm, paddingVertical: space.md },
  snippet: { gap: space.sm, paddingVertical: space.sm },
  code: {
    backgroundColor: colors.sunken,
    borderLeftWidth: 3,
    borderLeftColor: colors.ink,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  copy: { alignSelf: "flex-end" },
  prompt: {
    fontFamily: fonts.bodyItalic,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  notice: {
    marginTop: space.xl,
    marginHorizontal: space.lg,
    paddingLeft: space.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.ink,
  },
});
