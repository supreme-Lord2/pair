> **Deploy on Heroku**
<p align="left">  
<a href='https://dashboard.heroku.com/new?template=https://github.com/dot-666/pairCode/tree/main' target="_blank"><img alt='Deploy on Heroku' src='https://img.shields.io/badge/-Deploy%20on%20Heroku-430098?style=for-the-badge&logo=heroku&logoColor=white'/></a>  
</p>

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JUNE_INTAKE_KEY` | **Yes** | Site key issued by the June session-server owner. Without it the site cannot mint session tokens. |
| `JUNE_SESSION_SERVER_URL` | No | Defaults to the primary June session server. Only set this to point at a different June API deployment. |

Sessions minted here are official `june-ultra:~` tokens stored in the June
API database — the same credential the main pairing site produces.
