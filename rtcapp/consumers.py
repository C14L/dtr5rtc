from channels import Group


def get_group_name(message):
    return 'global_group'


def ws_connect(message):
    print('--> WS connect called.')
    group_name = get_group_name(message)
    Group(group_name).add(message.reply_channel)


def ws_receive(message):
    print('--> WS receive called: {}'.format(message['text']))
    group_name = get_group_name(message)
    Group(group_name).send({'text': message['text']})


def ws_disconnect(message):
    print('--> WS disconnect called.')
    group_name = get_group_name(message)
    Group(group_name).discard(message.reply_channel)
