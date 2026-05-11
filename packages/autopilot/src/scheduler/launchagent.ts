/**
 * macOS LaunchAgent generator.
 *
 * Alternatywa do in-process scheduler — uruchamia node CLI co N minut przez
 * launchd. Lepsze dla local dev (przeżywa restart komputera).
 */

export interface LaunchAgentOptions {
  label: string;
  command: string[];
  workingDirectory?: string;
  intervalSeconds?: number;
  /** Albo schedule: tablica { Hour, Minute, Weekday } */
  startCalendarInterval?: Array<{ Hour?: number; Minute?: number; Weekday?: number }>;
  stdout?: string;
  stderr?: string;
}

export function generateLaunchAgentPlist(opts: LaunchAgentOptions): string {
  const programArgs = opts.command.map((c) => `    <string>${escapeXml(c)}</string>`).join('\n');
  let schedule: string;
  if (opts.intervalSeconds) {
    schedule = `  <key>StartInterval</key>\n  <integer>${opts.intervalSeconds}</integer>`;
  } else if (opts.startCalendarInterval) {
    const items = opts.startCalendarInterval
      .map((s) => {
        const parts = [];
        if (s.Hour !== undefined) parts.push(`      <key>Hour</key><integer>${s.Hour}</integer>`);
        if (s.Minute !== undefined) parts.push(`      <key>Minute</key><integer>${s.Minute}</integer>`);
        if (s.Weekday !== undefined) parts.push(`      <key>Weekday</key><integer>${s.Weekday}</integer>`);
        return `    <dict>\n${parts.join('\n')}\n    </dict>`;
      })
      .join('\n');
    schedule = `  <key>StartCalendarInterval</key>\n  <array>\n${items}\n  </array>`;
  } else {
    schedule = `  <key>RunAtLoad</key>\n  <true/>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(opts.label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
${schedule}
${opts.workingDirectory ? `  <key>WorkingDirectory</key>\n  <string>${escapeXml(opts.workingDirectory)}</string>` : ''}
${opts.stdout ? `  <key>StandardOutPath</key>\n  <string>${escapeXml(opts.stdout)}</string>` : ''}
${opts.stderr ? `  <key>StandardErrorPath</key>\n  <string>${escapeXml(opts.stderr)}</string>` : ''}
</dict>
</plist>
`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
