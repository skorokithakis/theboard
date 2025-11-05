from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("main", "0007_rename_user_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="feature",
            name="expired_at",
            field=models.DateTimeField(
                blank=True,
                help_text="Timestamp for when the feature was retired without being implemented.",
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name="feature",
            name="votes",
            field=models.IntegerField(
                blank=True,
                help_text=(
                    "Historical vote count captured when the feature shipped or was retired. "
                    "Only used once the feature is implemented or expired to keep showing votes after nightly cleanup."
                ),
                null=True,
            ),
        ),
    ]
