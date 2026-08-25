import type { JobStatus } from '@job-me/shared';
import { STATUS_COLOR_VAR, STATUS_DISPLAY } from '@job-me/shared';
import styles from './StatusTag.module.css';

interface Props {
  status: JobStatus;
}

/**
 * Small JetBrains Mono uppercase tag — §4 "status tags are nouns/short verb phrases".
 * Color is always the stage token color. No emoji.
 */
export function StatusTag({ status }: Props) {
  return (
    <span
      className={styles.tag}
      style={{ color: STATUS_COLOR_VAR[status], borderColor: STATUS_COLOR_VAR[status] }}
    >
      {STATUS_DISPLAY[status]}
    </span>
  );
}
