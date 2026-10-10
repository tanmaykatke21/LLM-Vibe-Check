#!/usr/bin/env bash
# Phase 4 check: exercises the API end-to-end WITHOUT calling any LLM (uses graph validation + CRUD only).
set -e
B=http://localhost:8000
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)"; }

echo "1. health:        $(curl -s $B/health)"
echo "2. models:        $(curl -s $B/models | j "['llms'][0]['id']") ... tools=$(curl -s $B/models | j "['tools']")"

SKILL=$(curl -s $B/skills | python3 -c "import sys,json; d=[x for x in json.load(sys.stdin) if x['name']=='Python style']; print(d[0]['id'] if d else '')")
[ -z "$SKILL" ] && SKILL=$(curl -s -X POST $B/skills -H 'content-type: application/json' \
  -d '{"name":"Python style","instructions":"Use type hints and docstrings."}' | j "['id']")
echo "3. skill created: $SKILL"

TASK=$(curl -s -X POST $B/tasks -H 'content-type: application/json' \
  -d '{"title":"Date parser","description":"Write a Python function parse_date(s) that parses 2024-01-05, 01/05/2024 and Jan 5 2024 into a date.","task_type":"coding"}' | j "['id']")
echo "4. task created:  $TASK"

GRAPH='{"nodes":[
 {"id":"p","kind":"llm","label":"Planner","role":"planner","model":"anthropic/claude-haiku-5.5","skill_ids":["'$SKILL'"]},
 {"id":"e","kind":"llm","label":"Executor","role":"executor","model":"anthropic/claude-haiku-5.5"},
 {"id":"r","kind":"llm","label":"Reviewer","role":"reviewer","model":"anthropic/claude-haiku-5.5"}],
 "edges":[{"id":"1","source":"p","target":"e","type":"text"},{"id":"2","source":"e","target":"r","type":"text"},
          {"id":"back","source":"r","target":"e","type":"text","max_loops":1}]}'
SESSION=$(curl -s -X POST $B/sessions -H 'content-type: application/json' \
  -d "{\"name\":\"All-Haiku\",\"graph\":$GRAPH}" | j "['id']")
echo "5. session:       $SESSION"
echo "6. validate:      $(curl -s -X POST $B/sessions/$SESSION/validate)"

BAD='{"nodes":[{"id":"a","kind":"llm","model":"m"},{"id":"b","kind":"llm","model":"m"}],"edges":[{"id":"1","source":"a","target":"b"},{"id":"2","source":"b","target":"a"}]}'
echo "7. bad graph:     $(curl -s -X POST $B/graph/validate -H 'content-type: application/json' -d "$BAD")"
echo "8. sessions list: $(curl -s $B/sessions | j "[0]['name']")"
echo "9. docs:          $(curl -s -o /dev/null -w '%{http_code}' $B/docs) (200 = Swagger up)"
echo
echo "Saved for smoke run:"; echo "  SESSION_ID=$SESSION"; echo "  TASK_ID=$TASK"
printf "SESSION_ID=%s\nTASK_ID=%s\n" $SESSION $TASK > scripts/.ids
