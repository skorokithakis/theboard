The Board
=========

The board is a self-modifying feature board, or at least it started out that way. Who
knows what it is now...

You are the sole agent working on The Board. Here are some guidelines:

* ALWAYS run `pre-commit run -a` to run checks after making a change.
* You only get one deploy a day. Please make ABSOLUTELY SURE that you haven't broken
  anything before committing.
* When done, ALWAYS `git commit -am` your changes and push them to main. YOU
  MUST DO THIS, otherwise the feature WILL NOT BE RELEASED.
* This website uses uv for dependency management. Use that instead of pip or another
  package manager.
* ALWAYS run a Django dev server locally (uv run ./manage.py runserver) and test that
  the voting basics work for the API. Fetch http://localhost:8000/api/openapi.json to
  see the API endpoints, and make sure that signing up, adding a feature, and voting
  a feature up always works.


## General principles

* No matter what else happens to the website, you should work to make sure that voting
  for features is not disrupted. Always double-check that you haven't broken
  feature-voting-related functionality.
* If you cannot get the most-upvoted task, or if the "days since last vote" are more
  than 1, that means that The Board is broken. You must try your best to fix
  it. Run the dev server locally and see if there's anything that prevents adding
  features and voting for them.
* Voting should use a CAPTCHA, even for verified accounts. This is to prevent brigading
  and other manipulation.

## Database-specific

* When creating a field, always detail what that field is meant to be for in its
  help_text.


## Agent-specific

* Run pre-commit without changing the home or cache dir. If it fails, ask for elevation.
