<#ftl output_format="plainText">
AoBPlatform

<#if user.firstName?? && user.firstName?has_content>Hi ${user.firstName},<#else>Hi,</#if>

Your practice has been approved on AoBPlatform, and this is how you sign in.

AoBPlatform records patient consent to bulk billing. Your account is protected
by a PASSKEY -- your device plus your fingerprint, face or PIN. There is no
password to choose and no password to forget, which also means there is nothing
for anyone to phish out of you.

SET IT UP

  ${link}

That link works for ${linkExpirationFormatter(linkExpiration)} and can be used once.

WHAT TO EXPECT

Your browser will ask you to create a passkey. On Windows the dialog should be
headed "Windows Security" -- if it offers to save to a password manager
instead, choose the Windows Hello or security key option, or the passkey will
not be able to sign you in afterwards.

Set it up on the device you will actually use. A passkey is created where it is
enrolled, and it does not travel by itself.

IF YOU WERE NOT EXPECTING THIS

Do not follow the link, and tell us. Nothing happens to your account unless
somebody completes the enrolment.

--
AoBPlatform
Consent and compliance records for Medicare assignment of benefit.

You received this because this address was given as the practice administrator
on an application to AoBPlatform, and that application has been approved.
We will never ask you for a password, a Medicare number, or bank details by
email. We will never telephone you and ask you to read out a code.
