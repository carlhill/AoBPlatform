<#ftl output_format="plainText">
<#--
  ADDRESSED THE WAY A CLINICIAN IS ADDRESSED: title and family name.

  `firstName` holds the given names AS RECORDED, which for practitioners
  includes the title -- "Dr Jessica Leigh", "Ms Yu-Feng Judy". Greeting with it
  whole gives "Hi Dr Jessica Leigh," and greeting with the first word alone
  gave "Hi Dr,". Neither is how you would write to somebody.

  So: if the given names begin with a title and we have a family name, use
  those two. Otherwise fall back to the given names, then to nothing at all --
  a missing name must never produce a stray comma.
-->
<#assign given = (user.firstName!"")?trim>
<#assign family = (user.lastName!"")?trim>
<#assign titles = ["Dr", "Dr.", "Prof", "Prof.", "A/Prof", "Mr", "Mrs", "Ms", "Miss", "Mx"]>
<#assign lead = given?has_content?then(given?split(" ")[0], "")>
<#if titles?seq_contains(lead) && family?has_content>
  <#assign greeting = "Hi " + lead + " " + family + ",">
<#elseif given?has_content>
  <#assign greeting = "Hi " + given + ",">
<#else>
  <#assign greeting = "Hi,">
</#if>
AoBPlatform

${greeting}

This is how you sign in to AoBPlatform.

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
