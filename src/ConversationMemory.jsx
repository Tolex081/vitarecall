import { Database, RefreshCw } from 'lucide-react';

const labels = { queued: 'Queued in app - not yet on Walrus', processing: 'Awaiting Walrus confirmation', stored: 'Stored on Walrus mainnet', unknown: 'Submission unconfirmed', failed: 'Storage failed', cancelled: 'Cancelled before submission' };
export default function ConversationMemory({ state, canManage, configured, busy, onChange, onSync, onBackfill, receipts = false }) {
  if (!state || !canManage) return null;
  const pending = state.counts.queued + state.counts.processing;
  return <section className="automatic-memory" aria-label="Automatic conversation memory">
    <div className="automatic-memory-heading"><strong><Database size={16} /> Automatic conversation memory</strong><span className="soft-pill">{state.enabled ? 'On' : 'Off'}</span></div>
    <p>{state.enabled ? 'New messages and Vita replies are queued automatically. Clearing the chat does not remove confirmed memories.' : 'Enable this to remember complete new exchanges, including your messages and Vita replies, after you clear the chat.'}</p>
    <p className="small-text muted">Fictional information only. The Walrus relayer processes plaintext before encryption; relevant recalled text goes to Gemini. Chat archives stay private to this profile, separate from care-team notes. This does not automatically upload earlier chats. Pausing cancels unsent work, but cannot recall in-flight writes or delete existing blobs.</p>
    <div className="automatic-memory-actions"><button className="button secondary" disabled={busy} onClick={() => onChange(!state.enabled)}>{state.enabled ? 'Pause automatic memory' : 'Enable automatic memory'}</button>{(pending > 0 || receipts) && <button className="text-button" disabled={busy || !configured} onClick={onSync}><RefreshCw size={14} />Refresh chat memory</button>}</div>
    <p className="automatic-memory-status" role="status">{state.counts.stored} confirmed chat {state.counts.stored === 1 ? 'part' : 'parts'} on Walrus{pending > 0 ? `; ${pending} awaiting storage` : ''}.{state.counts.unknown > 0 ? ` ${state.counts.unknown} unconfirmed - open Patient memory for details.` : ''}{state.counts.failed > 0 ? ` ${state.counts.failed} failed - not stored.` : ''}</p>
    {!configured && <p className="small-text">Walrus is not configured. Queued exchanges cannot be uploaded yet.</p>}
    {pending > 0 && <p className="small-text muted">Keep the app open while saving. Queued work resumes when you reopen this same profile. Wait for confirmed blob IDs before testing recall; indexing can take longer. A new username creates a separate profile.</p>}
    {receipts && <>
      <p className="small-text muted">Earlier chats are not included unless you explicitly choose to archive them. This includes chats hidden by New conversation.</p>
      <button className="button secondary" disabled={busy || !state.enabled} onClick={onBackfill}>Also save earlier chats</button>
      <details className="conversation-receipts"><summary>Chat archive receipts ({state.records.length} recent parts)</summary>
        {state.records.length === 0 ? <p>No automatic chat memories yet.</p> : state.records.map(record => <article key={record.id} className="memory-record">
          <strong>{labels[record.status] || 'Status unavailable'}</strong><small>Part {record.part} of {record.parts}</small>
          <details><summary>View archived text</summary><p className="archived-text">{record.text}</p></details>
          {record.error && <p role="status">{record.error}</p>}
          {record.jobId && <div className="receipt-line"><span>Job ID</span><code>{record.jobId}</code></div>}
          {record.blobId && <><div className="receipt-line"><span>Blob ID</span><code>{record.blobId}</code></div><a className="text-button" href={`https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${encodeURIComponent(record.blobId)}?strict_consistency_check=true`} target="_blank" rel="noreferrer">View encrypted chat blob on mainnet</a></>}
        </article>)}
      </details>
    </>}
  </section>;
}
