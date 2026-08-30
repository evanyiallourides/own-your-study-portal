#!/bin/bash
# Does any page ever render data the signed-in person must not see?
#
# Runs against whatever is serving the portal. The default is `next dev`; point
# it at the Workers build to confirm the same rules hold on the deploy target,
# which is a different runtime and worth checking separately:
#
#   PORTAL_URL=http://localhost:8787 ./scripts/check-isolation.sh
BASE="${PORTAL_URL:-http://localhost:3000}"

body() { curl -s -H "Cookie: oys_demo_profile=$1" "$BASE$2" | python3 -c "
import sys,re,html
s=sys.stdin.read()
s=re.sub(r'<script.*?</script>','',s,flags=re.S)
s=re.sub(r'<[^>]+>',' ',s)
print(html.unescape(re.sub(r'\s+',' ',s)))"; }

# The join gate's answer lives in a meta tag and in the streamed RSC payload,
# neither of which survives body()'s tag stripping. Checking whether a meeting
# link was handed over means checking the bytes that were actually sent.
raw() { curl -s -H "Cookie: oys_demo_profile=$1" "$BASE$2"; }

fail=0
assert_absent() { # profile path needle label
  if body "$1" "$2" | grep -qi -- "$3"; then
    echo "LEAK  [$4]  $1 saw '$3' at $2"; fail=1
  else
    echo "ok    [$4]"
  fi
}

assert_absent_raw() { # profile path needle label
  if raw "$1" "$2" | grep -qi -- "$3"; then
    echo "LEAK  [$4]  $1 saw '$3' at $2"; fail=1
  else
    echo "ok    [$4]"
  fi
}

# The mirror of the above. Without it, a gate that refused everybody would pass
# every check in this file and look like airtight security.
assert_present_raw() { # profile path needle label
  if raw "$1" "$2" | grep -qi -- "$3"; then
    echo "ok    [$4]"
  else
    echo "FAIL  [$4]  $1 could not reach '$3' at $2"; fail=1
  fi
}

echo "--- Sophia (student) must never see Marcus, nor unreviewed notes, nor private notes ---"
assert_absent p-sophia /student                    "Marcus"                        "student home: other student"
assert_absent p-sophia /student/lessons            "Marcus"                        "student lessons: other student"
assert_absent p-sophia /student/lessons            "Transition metals"             "student lessons: other student topic"
assert_absent p-sophia /student/lessons/l-chem-8/notes "reaches for pattern recall" "student notes: tutor private notes"
assert_absent p-sophia /student/resources          "Marcus"                        "student resources"
assert_absent p-sophia /student/progress           "Transition metals"             "student progress"

echo "--- Daniel (maths tutor) must not see Sophia's chemistry, nor Marcus at all ---"
assert_absent p-daniel /tutor/students             "Marcus"                        "tutor students: unassigned student"
assert_absent p-daniel /tutor/lessons              "SN1 and SN2"                   "tutor lessons: other subject"
assert_absent p-daniel /tutor                      "Marcus"                        "tutor home"
assert_absent p-daniel /tutor/students/s-sophia    "Organic chemistry"             "tutor student page: other subject"
assert_absent p-daniel /tutor/resources            "SN1-vs-SN2-board"              "tutor resources: other subject file"

echo "--- Helen (parent) sees Sophia only, and never the transcript or private notes ---"
assert_absent p-helen  /parent                     "Marcus"                        "parent home"
assert_absent p-helen  /parent/lessons             "Marcus"                        "parent lessons"
assert_absent p-helen  /parent/lessons/l-chem-8    "reaches for pattern recall"    "parent lesson: private notes"
assert_absent p-helen  /parent/lessons/l-chem-8    "Why would this favour"         "parent lesson: transcript"

echo "--- Imogen (chem tutor) must not see Sophia's maths lessons ---"
assert_absent p-imogen /tutor/lessons            "Proof by induction"            "tutor lessons: other tutor's subject"

# The owner of the practice holds the admin role and a tutor record, so the
# teaching pages accept two roles rather than one. A gate that widened by
# accident would be an easy thing not to notice.
echo "--- the teaching pages take the owner, and nobody who does not teach ---"
assert_absent    p-sophia /tutor "Waiting on you"  "teaching: a student cannot open it"
assert_absent    p-helen  /tutor "Waiting on you"  "teaching: a parent cannot open it"
assert_absent    p-sophia /tutor/students "Marcus" "teaching: no student list for a student"
assert_present_raw p-admin /tutor "My students"    "teaching: the owner, who teaches, can"

echo "--- the join gate hands a meeting link only to the people in the lesson ---"
assert_absent_raw  p-sophia   /lessons/l-alevel-3/join   "teams.microsoft.com" "join: other student's lesson"
assert_absent_raw  p-daniel   /lessons/l-chem-live/join  "meet.google.com"     "join: tutor not assigned to it"
assert_absent_raw  p-helen    /lessons/l-chem-live/join  "meet.google.com"     "join: parent is not a participant"
assert_present_raw p-sophia   /lessons/l-chem-live/join  "meet.google.com"     "join: the student in the lesson"
assert_present_raw p-imogen /lessons/l-chem-live/join  "meet.google.com"     "join: the tutor teaching it"

exit $fail
