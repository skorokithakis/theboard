from django.conf import settings as sett

from main.health import get_board_health


def settings(request):
    return {"settings": sett}


def board_health(request):
    return {"board_health": get_board_health()}
