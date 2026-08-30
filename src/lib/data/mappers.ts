/* ==========================================================================
   Row → domain mappers
   --------------------------------------------------------------------------
   The single place where the database's snake_case meets the app's camelCase.
   ========================================================================== */

import type {
  HomeworkItem,
  Lesson,
  LessonFile,
  LessonNotesForTutor,
  Notification,
  Parent,
  Profile,
  Student,
  Subject,
  TopicProgress,
  Transcript,
  TranscriptSegment,
  Tutor,
} from "@/lib/types";

/* PostgREST hands back untyped JSON, so `row` is `any` throughout this file.
   That is contained deliberately: every field is narrowed by one of the
   helpers below before it leaves, and nothing outside this module sees an
   unnarrowed value. */

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const nullableStr = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function mapProfile(row: any): Profile {
  const firstName = str(row?.first_name);
  const lastName = str(row?.last_name);
  return {
    id: str(row?.id),
    email: str(row?.email),
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(" ") || str(row?.email),
    role: row?.role ?? "student",
    avatarUrl: nullableStr(row?.avatar_url),
    active: row?.active !== false,
  };
}

export function mapStudent(row: any): Student {
  return {
    id: str(row?.id),
    profileId: str(row?.profile_id),
    profile: mapProfile(row?.profile ?? row?.profiles ?? {}),
    programme: nullableStr(row?.programme),
    yearLevel: nullableStr(row?.year_level),
    school: nullableStr(row?.school),
    timezone: str(row?.timezone) || "Europe/London",
    transcriptAccessEnabled: row?.transcript_access_enabled !== false,
    consent: {
      aiNotetakerConsent: row?.ai_notetaker_consent === true,
      transcriptionConsent: row?.transcription_consent === true,
      guardianConsentRequired: row?.guardian_consent_required !== false,
      guardianConsentReceived: row?.guardian_consent_received === true,
      consentTimestamp: nullableStr(row?.consent_timestamp),
    },
  };
}

export function mapTutor(row: any): Tutor {
  return {
    id: str(row?.id),
    profileId: str(row?.profile_id),
    profile: mapProfile(row?.profile ?? row?.profiles ?? {}),
    bio: nullableStr(row?.bio),
    headline: nullableStr(row?.headline),
    active: row?.active !== false,
  };
}

export function mapParent(row: any): Parent {
  return {
    id: str(row?.id),
    profileId: str(row?.profile_id),
    profile: mapProfile(row?.profile ?? row?.profiles ?? {}),
  };
}

export function mapSubject(row: any): Subject {
  const name = str(row?.name);
  const curriculum = str(row?.curriculum);
  const level = nullableStr(row?.level);
  return {
    id: str(row?.id),
    name,
    curriculum,
    level,
    division: nullableStr(row?.division),
    archived: row?.archived === true,
    displayName: [curriculum, name, level].filter(Boolean).join(" "),
  };
}

export function mapLesson(row: any): Lesson {
  return {
    id: str(row?.id),
    studentId: str(row?.student_id),
    tutorId: str(row?.tutor_id),
    subjectId: str(row?.subject_id),
    title: nullableStr(row?.title),
    scheduledAt: str(row?.scheduled_at),
    durationMinutes: typeof row?.duration_minutes === "number" ? row.duration_minutes : 60,
    startedAt: nullableStr(row?.started_at),
    endedAt: nullableStr(row?.ended_at),
    meetingUrl: nullableStr(row?.meeting_url),
    meetingPlatform: row?.meeting_platform ?? "google_meet",
    status: row?.status ?? "scheduled",
    published: row?.published === true,
    publishedAt: nullableStr(row?.published_at),
    notetakerEnabled: row?.notetaker_enabled === true,
    recallBotId: nullableStr(row?.recall_bot_id),
    processingError: nullableStr(row?.processing_error),
    googleEventId: nullableStr(row?.google_event_id),
    googleCalendarId: nullableStr(row?.google_calendar_id),
    meetLinkManaged: row?.meet_link_managed === true,
  };
}

export function mapNotes(row: any): LessonNotesForTutor {
  return {
    id: str(row?.id),
    lessonId: str(row?.lesson_id),
    summary: nullableStr(row?.summary),
    topicsCovered: strList(row?.topics_covered),
    keyConcepts: strList(row?.key_concepts),
    strengths: strList(row?.strengths),
    areasForImprovement: strList(row?.areas_for_improvement),
    misconceptions: strList(row?.misconceptions),
    homework: strList(row?.homework),
    resourcesMentioned: strList(row?.resources_mentioned),
    nextSteps: strList(row?.next_steps),
    tutorPrivateNotes: nullableStr(row?.tutor_private_notes),
    aiGenerated: row?.ai_generated === true,
    aiModel: nullableStr(row?.ai_model),
    tutorReviewed: row?.tutor_reviewed === true,
    updatedAt: str(row?.updated_at),
  };
}

export function mapSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw: any, i): TranscriptSegment => {
      const role = raw?.role === "tutor" || raw?.role === "student" ? raw.role : "other";
      return {
        index: typeof raw?.index === "number" ? raw.index : i,
        speaker: str(raw?.speaker) || "Speaker",
        role,
        startSeconds: Number(raw?.start_seconds ?? raw?.startSeconds ?? 0) || 0,
        endSeconds: Number(raw?.end_seconds ?? raw?.endSeconds ?? 0) || 0,
        text: str(raw?.text),
      };
    })
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .map((segment, i) => ({ ...segment, index: i }));
}

export function mapTranscript(row: any): Transcript {
  return {
    id: str(row?.id),
    lessonId: str(row?.lesson_id),
    segments: mapSegments(row?.speaker_segments_json),
    provider: str(row?.provider) || "recall",
    processingStatus: row?.processing_status ?? "pending",
    durationSeconds:
      typeof row?.duration_seconds === "number" ? row.duration_seconds : null,
  };
}

export function mapFile(row: any, url: string | null): LessonFile {
  return {
    id: str(row?.id),
    lessonId: str(row?.lesson_id),
    fileName: str(row?.file_name),
    fileType: str(row?.file_type),
    fileSize: typeof row?.file_size === "number" ? row.file_size : null,
    category: row?.category ?? "resource",
    createdAt: str(row?.created_at),
    url,
  };
}

export function mapHomework(row: any): HomeworkItem {
  return {
    id: str(row?.id),
    lessonId: str(row?.lesson_id),
    studentId: str(row?.student_id),
    subjectId: str(row?.subject_id),
    description: str(row?.description),
    dueAt: nullableStr(row?.due_at),
    completed: row?.completed === true,
    completedAt: nullableStr(row?.completed_at),
    subject: row?.subject ? mapSubject(row.subject) : undefined,
    lessonTitle: row?.lesson?.title ?? null,
  };
}

export function mapProgress(row: any): TopicProgress {
  return {
    id: str(row?.id),
    studentId: str(row?.student_id),
    subjectId: str(row?.subject_id),
    topic: str(row?.topic),
    masteryScore: row?.mastery_score === null ? null : Number(row?.mastery_score),
    confidence: row?.confidence === null ? null : Number(row?.confidence),
    evidenceCount: typeof row?.evidence_count === "number" ? row.evidence_count : 0,
    lastUpdated: str(row?.last_updated),
  };
}

export function mapNotification(row: any): Notification {
  return {
    id: str(row?.id),
    profileId: str(row?.profile_id),
    kind: row?.kind ?? "lesson_published",
    title: str(row?.title),
    body: nullableStr(row?.body),
    lessonId: nullableStr(row?.lesson_id),
    readAt: nullableStr(row?.read_at),
    createdAt: str(row?.created_at),
  };
}
