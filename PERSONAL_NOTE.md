# The applications in my "core" homelab (i plan to develop)

- serving monitoring application
- budget tracker application
    - record expenses everyday
    - also record gains (from allowance, salary, revenue, assets etc.)
- reminder tool (coreban)
    - daily quests as todos (workout, programming)
    - anime/manga/manhwa/manhua updates
    - tech/dev daily news
    - **llmarena/latest AI models updates**
    - backlog clearing/old reads to revisit
    - "Core reminds me to..." (philosophical, grounded mental)
        - self learn, have strong fundamentals (language-agnostic)
            - system design, caching patterns, etc.
            - linux troubleshooting scenarios, kubernetes
        - job hop for growth potential
        - the work you do needs to be broadly communicated for visibility in order to be considered for high ratings and compensation increases.
        - programming is just moving data around and managing state.
    - academic/organization work
    - job application/openings (opt, since i have linkedin, etc.)
- wardrobe management system
    - start picturing clothes with name (like in uniqlo), description
- learning management system (quiz or LMS)
    - catered to myself.
    - Course -> Lesson -> Topic -> Question -> AnswerOption
    - see: [High-level approach: two buckets - content vs user state](https://www.reddit.com/r/Backend/comments/1qlz9h6/comment/o1i9yns/?utm_source=share&utm_medium=web3x&utm_name=web3xcss&utm_term=1&utm_content=share_button)

        > [COMMENT]
        > High-level approach:
        >
        > Think in two buckets: content vs user state.
        >
        > Content is a tree and never knows about users
        > Course → Lesson → Topic → Question → AnswerOption
        > Everything is ordered explicitly (order fields). No progress, no users, just structure.
        >
        > User progress lives in junction tables
        > Instead of flags on content, you store:
        >
        >     Enrollment (user ↔ course)
        >
        >     LessonProgress (user ↔ lesson)
        >
        >     TopicProgress (user ↔ topic)
        >
        > That’s where completion, last activity, and resume pointers go.
        >
        > Resume beats percentages
        > Store “last lesson / topic / question” so you can drop users exactly where they left off. Percent complete can always be computed later.
        >
        > Quizzes are sessions, not states
        > A QuizAttempt = one user, one topic, one run.
        > Each attempt has many QuizResponses. Attempts are immutable history; score is saved on the attempt.
        >
        > History vs snapshot
        > Attempts/responses = truth.
        > Progress tables = cached “current state” for fast loading.
        >
        > Prereqs = graph, not booleans
        > Model prerequisites as TopicPrerequisite(topic, prereq_topic) so you can enforce or extend later without schema pain.
        >
        > If you separate content, progress, and attempts cleanly, everything else (analytics, retries, certificates, adaptive paths) falls out naturally.
