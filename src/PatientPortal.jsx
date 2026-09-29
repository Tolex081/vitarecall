import { useMemo, useState } from "react";
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  HeartPulse,
  Info,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Pill,
  Plus,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserRound,
} from "lucide-react";
import clinicianImage from "./assets/vitarecall-walrus-clinician.png";

const careTasks = [
  {
    id: "medicine",
    title: "Take amlodipine",
    description: "5 mg each morning, as prescribed.",
    tag: "Today",
  },
  {
    id: "pressure",
    title: "Check your blood pressure",
    description: "Record a reading before your next visit if you can.",
    tag: "This week",
  },
  {
    id: "questions",
    title: "Prepare questions for your visit",
    description: "Vita can help you make a simple list.",
    tag: "Before Friday",
  },
];

function VitaMark() {
  return (
    <span className="patient-vita-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function CareTask({ task, complete, onToggle }) {
  return (
    <button
      className={`patient-care-task ${complete ? "is-complete" : ""}`}
      type="button"
      aria-pressed={complete}
      onClick={() => onToggle(task.id)}
    >
      <span className="patient-task-check" aria-hidden="true">
        {complete && <Check size={15} strokeWidth={2.8} />}
      </span>
      <span className="patient-task-copy">
        <strong>{task.title}</strong>
        <small>{task.description}</small>
      </span>
      <span className="patient-task-tag">{task.tag}</span>
    </button>
  );
}

/**
 * Patient-facing VitaRecall home view.
 *
 * onOpenChat is intentionally called with an optional starter prompt so the
 * host can either ignore it or seed the chat composer with the chosen topic.
 */
export default function PatientPortal({ onOpenChat, onExitPatientView }) {
  const [completedTasks, setCompletedTasks] = useState(["medicine"]);
  const [notice, setNotice] = useState("");

  const completedCount = completedTasks.length;
  const progressText = useMemo(
    () => `${completedCount} of ${careTasks.length} steps complete`,
    [completedCount],
  );

  function openChat(starterPrompt = "") {
    onOpenChat?.(starterPrompt);
  }

  function toggleTask(taskId) {
    const isComplete = completedTasks.includes(taskId);
    setCompletedTasks((current) => {
      return isComplete
        ? current.filter((id) => id !== taskId)
        : [...current, taskId];
    });
    setNotice(isComplete ? "Marked as not done yet." : "Nice work — marked as done.");
  }

  return (
    <section className="patient-portal">
      <header className="patient-topbar">
        <a className="patient-brand" href="#patient-home" aria-label="VitaRecall home">
          <VitaMark />
          <span>
            Vita<span>Recall</span>
            <small>Your care space</small>
          </span>
        </a>

        <div className="patient-topbar-actions">
          {onExitPatientView && (
            <button
              className="patient-view-toggle"
              type="button"
              onClick={onExitPatientView}
            >
              <Stethoscope size={15} />
              <span>Care team view</span>
            </button>
          )}
          <button
            className="patient-bell-button"
            type="button"
            aria-label="You have one new notification"
            onClick={() => setNotice("Your appointment reminder is ready to view below.")}
          >
            <Bell size={19} />
            <i aria-hidden="true" />
          </button>
          <button
            className="patient-profile-button"
            type="button"
            aria-label="Open Adaeze's profile"
            onClick={() => setNotice("Profile settings will be available here.")}
          >
            <span>AO</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </header>

      <div id="patient-home" className="patient-page">
        <section className="patient-hero" aria-labelledby="patient-welcome-title">
          <div className="patient-hero-copy">
            <p className="patient-eyebrow">
              <span><Sparkles size={13} /></span>
              YOUR CARE, MADE EASIER
            </p>
            <h1 id="patient-welcome-title">Good morning, Adaeze.</h1>
            <p className="patient-hero-description">
              Your plan, appointments, and a helpful guide are all in one calm place.
            </p>

            <button
              className="patient-chat-cta"
              type="button"
              onClick={() => openChat()}
            >
              <span className="patient-chat-cta-icon"><MessageCircle size={22} /></span>
              <span className="patient-chat-cta-copy">
                <strong>Chat with Vita</strong>
                <small>Ask about your care, medicines, or next visit</small>
              </span>
              <ArrowRight size={19} aria-hidden="true" />
            </button>
            <p className="patient-chat-safety"><LockKeyhole size={12} /> Private and connected to your care team</p>
          </div>

          <div className="patient-hero-art" aria-hidden="true">
            <div className="patient-hero-aura" />
            <img src={clinicianImage} alt="" />
            <div className="patient-hero-art-card">
              <span><HeartPulse size={16} /></span>
              <p><strong>Small steps add up</strong><small>Your care plan is ready when you are.</small></p>
            </div>
          </div>
        </section>

        <section className="patient-urgent-note" aria-label="For urgent help">
          <span><Info size={18} /></span>
          <p><strong>Need urgent help?</strong> Vita is not for emergencies. If you think you are having an emergency, call your local emergency number now.</p>
        </section>

        <div className="patient-dashboard-grid">
          <section className="patient-main-column" aria-label="Your care overview">
            <div className="patient-section-heading">
              <div>
                <p className="patient-eyebrow">YOUR NEXT STEP</p>
                <h2>Upcoming appointment</h2>
              </div>
              <button type="button" onClick={() => setNotice("Appointment details are ready to review.")}>View details <ChevronRight size={15} /></button>
            </div>

            <article className="patient-appointment-card">
              <div className="patient-appointment-date">
                <span>OCT</span>
                <strong>02</strong>
                <small>FRI</small>
              </div>
              <div className="patient-appointment-copy">
                <p className="patient-appointment-label"><CalendarDays size={14} /> In 3 days</p>
                <h3>Blood pressure follow-up</h3>
                <p>With Dr. Ifeoma Okoro · Internal Medicine</p>
                <div className="patient-appointment-meta">
                  <span><Clock3 size={14} /> 10:30 AM · about 20 min</span>
                  <span className="patient-appointment-place"><UserRound size={14} /> Northstar Health</span>
                </div>
              </div>
              <div className="patient-appointment-actions">
                <button className="patient-secondary-button" type="button" onClick={() => setNotice("We will remind you one day before your visit.")}>Set reminder</button>
                <button className="patient-link-button" type="button" onClick={() => openChat("I have a question about my upcoming appointment.")}>Ask Vita <ArrowRight size={14} /></button>
              </div>
            </article>

            <div className="patient-section-heading patient-plan-heading">
              <div>
                <p className="patient-eyebrow">TAKE IT ONE STEP AT A TIME</p>
                <h2>Your care plan</h2>
              </div>
              <span className="patient-progress-text">{progressText}</span>
            </div>

            <div className="patient-progress-track" aria-label={progressText}>
              <i className={`patient-progress-fill progress-${completedCount}`} />
            </div>

            <div className="patient-care-list">
              {careTasks.map((task) => (
                <CareTask
                  key={task.id}
                  task={task}
                  complete={completedTasks.includes(task.id)}
                  onToggle={toggleTask}
                />
              ))}
            </div>
            <button className="patient-plan-assist" type="button" onClick={() => openChat("Help me understand my care plan.")}>
              <Sparkles size={16} />
              <span><strong>Want help with this plan?</strong><small>Chat with Vita in plain language.</small></span>
              <ChevronRight size={17} />
            </button>

            <section className="patient-memory-card" aria-labelledby="patient-memory-heading">
              <div className="patient-memory-icon"><ShieldCheck size={21} /></div>
              <div className="patient-memory-copy">
                <p className="patient-eyebrow">YOUR INFORMATION, YOUR CONTROL</p>
                <h2 id="patient-memory-heading">What Vita remembers</h2>
                <p>Vita uses the care information you and your care team have chosen to keep, so you do not have to repeat yourself.</p>
                <ul>
                  <li><CheckCircle2 size={14} /> You can see what is saved about you.</li>
                  <li><CheckCircle2 size={14} /> You can ask to correct or remove something.</li>
                  <li><CheckCircle2 size={14} /> Your care team reviews clinical changes.</li>
                </ul>
                <button type="button" onClick={() => setNotice("Your memory and privacy controls will open here.")}>Review my memory and privacy <ArrowRight size={15} /></button>
              </div>
              <div className="patient-memory-count"><strong>6</strong><span>care details<br />saved for you</span></div>
            </section>
          </section>

          <aside className="patient-side-column" aria-label="Quick health details">
            <section className="patient-vita-prompt-card">
              <div className="patient-vita-prompt-topline">
                <span className="patient-vita-orb"><MessageCircle size={18} /></span>
                <span>VITA IS HERE</span>
              </div>
              <h2>How can I help?</h2>
              <p>Choose a topic, or start a conversation whenever you need to.</p>
              <div className="patient-question-list">
                <button type="button" onClick={() => openChat("What should I know about amlodipine?")}><Pill size={16} /> My medicine <ChevronRight size={15} /></button>
                <button type="button" onClick={() => openChat("Help me prepare for my appointment.")}><CalendarDays size={16} /> My appointment <ChevronRight size={15} /></button>
                <button type="button" onClick={() => openChat("Please explain my care plan in simple words.")}><ClipboardCheck size={16} /> My care plan <ChevronRight size={15} /></button>
              </div>
              <button className="patient-chat-secondary-cta" type="button" onClick={() => openChat()}><MessageCircle size={17} /> Chat with Vita</button>
            </section>

            <section className="patient-medication-card" aria-labelledby="patient-medication-heading">
              <div className="patient-card-title-row">
                <span className="patient-card-icon patient-card-icon-indigo"><Pill size={18} /></span>
                <div><p className="patient-eyebrow">MEDICINE</p><h2 id="patient-medication-heading">Today</h2></div>
                <button type="button" aria-label="Medication options" onClick={() => setNotice("Medication details are ready to review.")}><MoreHorizontal size={19} /></button>
              </div>
              <div className="patient-medication-dose">
                <strong>Amlodipine</strong>
                <span>5 mg · once each morning</span>
              </div>
              <p>For your blood pressure. Take it exactly as your clinician prescribed.</p>
              <button className="patient-link-button" type="button" onClick={() => openChat("What should I know about taking amlodipine?")}>Ask about this medicine <ArrowRight size={14} /></button>
            </section>

            <section className="patient-care-team-card" aria-labelledby="patient-care-team-heading">
              <p className="patient-eyebrow">YOUR CARE TEAM</p>
              <h2 id="patient-care-team-heading">You are not doing this alone.</h2>
              <div className="patient-clinician-row">
                <span className="patient-clinician-avatar">IO</span>
                <span><strong>Dr. Ifeoma Okoro</strong><small>Internal Medicine</small></span>
                <span className="patient-available-dot" title="Available through Vita" />
              </div>
              <button type="button" onClick={() => openChat("I would like to send a message to my care team.")}><Plus size={15} /> Start a message</button>
            </section>
          </aside>
        </div>
      </div>

      <nav className="patient-mobile-nav" aria-label="Patient navigation">
        <a href="#patient-home"><HeartPulse size={19} /><span>Home</span></a>
        <button type="button" onClick={() => openChat()}><MessageCircle size={21} /><span>Chat</span></button>
        <button type="button" onClick={() => setNotice("Your care plan is above.")}><ClipboardCheck size={19} /><span>Plan</span></button>
        <button type="button" onClick={() => setNotice("Profile settings will be available here.")}><UserRound size={19} /><span>Me</span></button>
      </nav>

      {notice && (
        <div className="patient-toast" role="status">
          <CheckCircle2 size={17} />
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button>
        </div>
      )}
    </section>
  );
}
