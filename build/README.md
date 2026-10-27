# build - where runnable builds go

Step 00 produces no app yet (plan rule: no app code in Step 00), so there
is nothing to launch from this folder today.

What you can run now, to check this PC is ready:

    .\build\check-environment.ps1

From Step 01b onward, the runnable development build will be placed in
this folder (build\Adperastra\) with a RUN.txt saying exactly what to
double-click. Release installers are made only in Step 08c and published
on GitHub Releases; they are never committed to Git.

Everything in this folder except this README and the check script is
ignored by Git (built files can be large).
